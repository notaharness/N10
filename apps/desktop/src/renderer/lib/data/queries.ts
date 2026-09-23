import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiffLine } from '@n10/diff';
import { contentKey } from '../content-key.js';
import { loadDesktopPrefs } from '../desktop-prefs.js';
import { parseDiffInWorker } from '../diff/diff-worker-client.js';
import { measured } from '../perf.js';
import { keys } from './query-keys.js';
import { errorMessage } from '../utils.js';
import type { RepoInfo, SidebarItem } from '../../../host/contract.js';

/**
 * The renderer's reads: every host query the app makes, so refetch
 * cadence, caching and dedupe live in one place instead of ad-hoc
 * setInterval/useEffect pairs in components. The writes that invalidate
 * them are in `mutations.ts`; the key catalog they share is in
 * `query-keys.ts`.
 */

/**
 * The boot read behind the repo gate: which repository the host is on,
 * and the one-time load of the desktop prefs.
 *
 * The prefs ride along rather than getting a key of their own because
 * the gate has to wait for both before it paints — the repo decides
 * which screen renders, the prefs decide the theme and window frame it
 * renders with — and a second gating query would have to be exempted
 * from every cache reset to avoid re-entering its loading state.
 *
 * A host that cannot name a repository has none open, which is a
 * screen (the picker), not an error. Resolving to `null` instead of
 * rejecting is what keeps a failing host off the loading screen.
 */
export async function loadRepoGate(): Promise<RepoInfo | null> {
  const [repo] = await Promise.all([
    window.n10.getRepo().catch(() => null),
    loadDesktopPrefs(),
  ]);
  return repo;
}

export function useRepoGate() {
  return useQuery({
    queryKey: keys.repo,
    queryFn: loadRepoGate,
    // Written by hand when the user opens or leaves a repository; there
    // is nothing to re-poll, and a refetch would re-run the prefs load.
    staleTime: Infinity,
  });
}

export function useVersion() {
  return useQuery({
    queryKey: keys.version,
    queryFn: () => window.n10.getVersion(),
    staleTime: Infinity,
  });
}

export function useRecentRepos() {
  return useQuery({
    queryKey: keys.recents,
    queryFn: () => window.n10.listRecentRepos(),
    staleTime: 0,
  });
}

/**
 * The sidebar rows for `cwd`, from a host that answers for whichever
 * repository it has open.
 *
 * An answer about another repository is not this workspace's, however
 * it arrived: the host moves on before the renderer does during a
 * switch, and the workspace being left keeps polling until it unmounts.
 * Reconciling such an answer into this repo's tabs opens a tab stamped
 * with this repo for a branch that exists only in the other one — a
 * tab that then reads as the other repo's and opens it when clicked.
 * So the rows stay what they were, and a first poll with nothing to
 * keep shows nothing rather than someone else's rows.
 */
export async function loadSidebarModel(
  cwd: string,
  previous: SidebarItem[] | undefined
): Promise<SidebarItem[]> {
  const answer = await window.n10.getSidebarModel();
  if (answer.cwd !== cwd) return previous ?? [];
  return answer.items;
}

/** Sidebar model. Local state (worktrees, alive PTYs) is cheap so we
 *  poll it every few seconds; remote PR data is cached host-side and
 *  only re-fetched on its own interval or an explicit refresh. */
export function useSidebarModel(cwd: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.sidebar(cwd),
    queryFn: () => loadSidebarModel(cwd, qc.getQueryData(keys.sidebar(cwd))),
    refetchInterval: 4_000,
    placeholderData: (prev) => prev,
  });
}

export function useSyncState(cwd: string) {
  return useQuery({
    queryKey: keys.sync(cwd),
    queryFn: () => window.n10.getSyncState(),
    refetchInterval: 4_000,
    placeholderData: (prev) => prev,
  });
}

export function useAllBranches(cwd: string, enabled = true) {
  return useQuery({
    queryKey: keys.branches(cwd),
    queryFn: () => window.n10.listAllBranches(),
    enabled,
    staleTime: 30_000,
  });
}

export type BranchRemovalSafety =
  | { safe: true }
  | { safe: false; reason: string };

/**
 * Whether git will let this branch and its worktree go. A refusal is a
 * verdict, not a failure, so a host call that throws is folded into an
 * unsafe answer: the dialog reads one value and defaults to refusing
 * when it cannot tell, rather than offering a confirm button behind an
 * error state nobody renders.
 */
export function loadBranchRemovalSafety(
  branch: string
): Promise<BranchRemovalSafety> {
  return window.n10.canRemoveBranch(branch).catch((err: unknown) => ({
    safe: false as const,
    reason: errorMessage(err),
  }));
}

/**
 * The verdict is a snapshot of the working tree, so it is not kept past
 * the dialog that asked for it (`gcTime: 0`) — reopening after a commit
 * or a push has to ask again instead of replaying the old answer.
 */
export function useBranchRemovalSafety(cwd: string, branch: string) {
  return useQuery({
    queryKey: keys.branchRemoval(cwd, branch),
    queryFn: () => loadBranchRemovalSafety(branch),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useSettingsView(cwd: string) {
  return useQuery({
    queryKey: keys.settings(cwd),
    queryFn: () => window.n10.getSettingsView(),
  });
}

export function useDiff(
  cwd: string,
  source: string,
  target: string,
  opts: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: keys.diff(cwd, source, target),
    queryFn: () =>
      measured('fetch', () => window.n10.fetchDiffText(source, target)),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}

/**
 * The working state of a worktree, refreshed while its agent runs so
 * the diff tracks what the agent is doing instead of what it last
 * committed.
 *
 * This is deliberately a different query from `useDiff`, not a mode of
 * it. A pull request is reviewed against its commits — that is what the
 * comments anchor to and what the author asked to have read — so a PR
 * tab must not start showing somebody's uncommitted scratch work. Only
 * a worktree without a PR gets the live view.
 *
 * Polled rather than watched: a recursive `fs.watch` over a checkout
 * means an inotify handle per directory, and `node_modules` alone
 * exhausts the default budget on Linux. The interval matches the draft
 * comment poll, and stops when the agent does — an idle worktree only
 * changes when the user does something the app already invalidates on.
 */
export function useWorktreeDiff(
  cwd: string,
  branch: string,
  target: string,
  opts: { enabled: boolean; live: boolean }
) {
  return useQuery({
    queryKey: keys.worktreeDiff(cwd, branch, target),
    queryFn: () =>
      measured('fetch', () => window.n10.fetchWorktreeDiffText(branch, target)),
    enabled: opts.enabled,
    refetchInterval: opts.live ? 2_000 : false,
    // Keep the previous patch on screen while the next one is in
    // flight, so a poll does not blank the viewer every two seconds.
    placeholderData: (prev) => prev,
    staleTime: 0,
  });
}

/**
 * A patch split into per-file line lists, parsed off the main thread —
 * whole-file diffs run to megabytes and the parse would otherwise block
 * the first paint of a tab.
 *
 * Keyed on the content of the patch (via `contentKey`, see there for
 * why the text itself is not the key), which is what makes a stale
 * parse unrepresentable: new text is a different key, and a key that
 * has not resolved yet has no data, so the caller renders nothing
 * rather than the previous patch's files.
 *
 * `gcTime: 0` because these are the largest objects the renderer holds
 * and a live worktree diff mints a new key every couple of seconds;
 * once nothing is looking at a parse there is no reason to keep it.
 */
export function useParsedDiff(text: string | undefined) {
  const content = useMemo(() => (text == null ? '' : contentKey(text)), [text]);
  return useQuery({
    queryKey: keys.parsedDiff(content),
    // A patch that cannot be parsed is an empty one: the viewer says
    // "no changes" instead of hanging on a spinner forever.
    queryFn: (): Promise<[string, DiffLine[]][]> =>
      parseDiffInWorker(text ?? '').catch(() => []),
    enabled: text != null,
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useThreads(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.threads(cwd, prId),
    queryFn: () => window.n10.fetchCommentThreads(prId),
    staleTime: 30_000,
    // prId 0 = a worktree without a PR: nothing to fetch.
    enabled: prId > 0,
  });
}

/** The session menu's agent picker rows, configured default first. */
export function useAgentOptions(cwd: string) {
  return useQuery({
    queryKey: keys.agentOptions(cwd),
    queryFn: () => window.n10.listAgentOptions(),
  });
}

/**
 * Sessions the host has actually launched this run — running, or ended
 * with their final frame kept. This is the "does a PTY exist?" signal:
 * the sidebar names a would-be session for every worktree, so a name
 * alone must never be read as one existing (it is what made a fresh
 * worktree offer "Relaunch agent").
 */
export function useSessions(cwd: string) {
  return useQuery({
    queryKey: keys.sessions(cwd),
    queryFn: () => window.n10.listSessions(),
    refetchInterval: 2_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Every terminal tab the host holds, whatever repository is open. Not
 * keyed by repo on purpose: the strip is reconciled against this list
 * from every workspace, and a restored terminal's tab is opened off it.
 */
export function useTerminals() {
  return useQuery({
    queryKey: keys.terminals,
    queryFn: () => window.n10.listTerminals(),
    refetchInterval: 2_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Agents alive in other repositories, for the tab strip to give each
 * a tab in its own group — the restore path after a relaunch with work
 * open across several repositories. The host answers from tmux and a
 * cached git lookup per worktree; a poll on discovery's own cadence is
 * plenty, since the interesting moment is launch.
 */
export function useForeignSessions() {
  return useQuery({
    queryKey: keys.foreignSessions,
    queryFn: () => window.n10.listForeignSessions(),
    refetchInterval: 4_000,
    placeholderData: (prev) => prev,
  });
}

/** Debounced per-session agent activity (spinner/blink source). The
 *  snapshot is an in-memory read host-side, so a 1s poll is cheap. */
export function useSessionActivity(cwd: string) {
  return useQuery({
    queryKey: keys.activity(cwd),
    queryFn: () => window.n10.getSessionActivity(),
    refetchInterval: 1_000,
    placeholderData: (prev) => prev,
  });
}

export function usePrDescription(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.prDescription(cwd, prId),
    queryFn: () => window.n10.fetchPrDescription(prId),
    staleTime: 5 * 60_000,
    enabled: prId > 0,
  });
}

/** Comment image bytes (as a data URL), fetched host-side with auth. */
export function useCommentImage(url: string) {
  return useQuery({
    queryKey: keys.commentImage(url),
    queryFn: () => window.n10.fetchCommentImage(url),
    enabled: url.length > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}

/** Draft review comments written by the review agent; polled so they
 *  show up in the diff while the agent is still working. */
export function useDraftComments(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.drafts(cwd, prId),
    queryFn: () => window.n10.listDraftComments(prId),
    refetchInterval: 2_000,
    placeholderData: (prev) => prev,
    enabled: prId > 0,
  });
}
