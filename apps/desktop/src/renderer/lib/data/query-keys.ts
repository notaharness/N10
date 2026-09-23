import { QueryClient } from '@tanstack/react-query';

/**
 * The renderer's data layer: every host call is a TanStack Query so
 * refetch cadence, caching, dedupe and invalidation live in one place
 * instead of ad-hoc setInterval/useEffect pairs in components.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export const keys = {
  repo: ['repo'] as const,
  version: ['version'] as const,
  recents: ['recents'] as const,
  sidebar: (cwd: string) => ['sidebar', cwd] as const,
  sync: (cwd: string) => ['sync', cwd] as const,
  branches: (cwd: string) => ['branches', cwd] as const,
  settings: (cwd: string) => ['settings', cwd] as const,
  sessions: (cwd: string) => ['sessions', cwd] as const,
  /** Not repo-scoped: a terminal belongs to a directory, and the host
   *  lists every one whatever repository is open. */
  terminals: ['terminals'] as const,
  /** Not repo-scoped either: agents alive in *other* repositories, the
   *  same answer whichever repository is open. */
  foreignSessions: ['foreign-sessions'] as const,
  agentOptions: (cwd: string) => ['agent-options', cwd] as const,
  diff: (cwd: string, source: string, target: string) =>
    ['diff', cwd, source, target] as const,
  worktreeDiff: (cwd: string, branch: string, target: string) =>
    ['worktree-diff', cwd, branch, target] as const,
  parsedDiff: (content: string) => ['parsed-diff', content] as const,
  threads: (cwd: string, prId: number) => ['threads', cwd, prId] as const,
  prDescription: (cwd: string, prId: number) =>
    ['pr-description', cwd, prId] as const,
  activity: (cwd: string) => ['session-activity', cwd] as const,
  commentImage: (url: string) => ['comment-image', url] as const,
  drafts: (cwd: string, prId: number) => ['drafts', cwd, prId] as const,
  reviewViewer: (cwd: string) => ['review-viewer', cwd] as const,
  branchRemoval: (cwd: string, branch: string) =>
    ['branch-removal', cwd, branch] as const,
  // Diff-worker results (see lib/highlight.ts). `linesKey` is a hash of
  // the lines' types and contents, not of the array instance, so the
  // same lines are one cache entry however many arrays hold them —
  // which is what keeps the review walkthrough, whose snippet array is
  // rebuilt every render, off the worker.
  fileAnalysis: (file: string, linesKey: string, theme: string) =>
    ['file-analysis', file, linesKey, theme] as const,
  codeTokens: (tag: string, theme: string, code: string) =>
    ['code-tokens', tag, theme, code] as const,
};

/** Keys that survive a repository switch. */
const CROSS_REPO_KEYS: ReadonlySet<string> = new Set([
  keys.repo[0],
  keys.terminals[0],
  keys.foreignSessions[0],
]);

/**
 * Drop everything cached for the repository being left.
 *
 * Every other key is repo-scoped — sidebar, diffs, threads, settings —
 * and in-flight mutation state goes too, so a worktree removal pending
 * in the old repo cannot hide a same-named row in the new one.
 *
 * Two entries are deliberately spared. The repo entry: the gate
 * observes it, and removing it would drop that observer into its
 * pending state for a frame, flashing the loading screen between two
 * workspaces. And the two cross-repository listings — terminals, which
 * belong to directories rather than to the repository being left, and
 * agents alive in other repositories — since the tab strip is
 * reconciled against both wherever the user goes.
 */
export function resetRepoScopedCache(qc: QueryClient): void {
  qc.removeQueries({
    predicate: (query) => !CROSS_REPO_KEYS.has(String(query.queryKey[0])),
  });
  qc.getMutationCache().clear();
}
