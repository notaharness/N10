import { worktreeSessionKey } from '../session-key.js';
import { sessionKeyForBranch } from '../worktree-rows.js';
/**
 * Watching a pull request on an agent's behalf.
 *
 * "Babysit" on a pull request means: keep an eye on its CI, its
 * unresolved review threads and whether it still merges cleanly into
 * its target, and when something needs doing, tell the agent working
 * on it — once, in one message, after the news has stopped changing,
 * and only while the agent is idle. An agent mid-task is not
 * interrupted; the update waits for it.
 *
 * The rules about what is news and when it is quiet enough to send are
 * `babysit-model.ts`'s. This file owns the loop: polling, the git and
 * provider calls that make an observation, and delivery through the
 * same paths every other prompt takes — typed into a live session, or
 * as the opening prompt of a session started in the pull request's
 * worktree when there is none. Both shells drive it; the desktop adds
 * only its session bookkeeping.
 *
 * Two of the guards here are the desktop's, honoured through options
 * rather than reimplemented: the session registry is keyed by bare
 * branch name, so a live session under this name may belong to another
 * repository (`isForeignSession`), and the open repository can change
 * between two awaits of one poll (`isCurrent`), after which the
 * branch names in hand mean nothing to the shell. The git calls
 * themselves are told which repository they are about: each
 * names `cwd`, the repository the pull request belongs to.
 */
import { logError } from '@n10/logger';
import type { AppConfig, PullRequestInfo, VcsProvider } from '@n10/vcs-core';
import { checkoutWorktree, refExists } from '@n10/worktree-manager';
import { idleFor } from '../activity.js';
import { isSessionAlive } from '../pty-registry.js';
import {
  deliverToRunningSession,
  launchSession,
} from '../session/launch-session.js';
import {
  BABYSIT_IDLE_MS,
  BABYSIT_POLL_MS,
  initialBabysitState,
  isDue,
  observe,
  statusSignature,
  takeReport,
  type BabysitHold,
  type BabysitState,
  type BabysitStatus,
  type DeliveryTiming,
} from './babysit-model.js';
import { observePullRequest, type RemoteSnapshot } from './babysit-observe.js';
import { composeBabysitPrompt } from './babysit-prompt.js';
import type { PullRequestLookup } from '../pull-requests/pull-request-cache.js';

export interface PrBabysitterOptions {
  pr: PullRequestInfo;
  /** The repository the pull request belongs to. Every git call runs
   *  against it, whatever the process's directory is by then. */
  cwd: string;
  /** Read per poll, like the config: a vendor switched in Settings
   *  takes effect on the next poll rather than at the next start. */
  getProvider: () => VcsProvider | null;
  /** Read per poll, so a credential change takes effect. */
  getConfig: () => AppConfig;
  readPullRequest: () => Promise<PullRequestLookup>;
  /** Grid for an agent started because none was running. */
  paneSize: () => { cols: number; rows: number };
  /** A session was started in `cwd` to receive the update. The
   *  desktop attaches its output relay here. */
  onSpawned?: (name: string, cwd: string) => void;
  /** A live session under this name belongs to another repository. */
  isForeignSession?: (name: string) => boolean;
  /** Fires on a transition — the phase, a hold, a delivery, an error
   *  appearing or clearing, the end — and not on a poll that left all
   *  of that where it was. `status()` is always current regardless. */
  onStatus: (status: BabysitStatus) => void;
  /** Defaults come from the environment when set (`babysitTimingFromEnv`),
   *  then from the model's constants. */
  intervalMs?: number;
  remoteRefreshMs?: number;
  idleMs?: number;
  timing?: DeliveryTiming;
  /** Returning false skips a tick — the desktop can have another
   *  repository open, and this one's branch names mean nothing there. */
  isCurrent?: () => boolean;
  now?: () => number;
}

export interface PrBabysitter {
  /** Poll now rather than at the next tick. Resolves when the poll,
   *  and any delivery it led to, has finished. */
  pollNow(): Promise<void>;
  status(): BabysitStatus;
  /** Stop watching. Idempotent. */
  stop(): void;
}

/**
 * The cadence as the environment overrides it, so a test in any shell
 * can watch a delivery happen in seconds rather than the ten minutes a
 * reviewer gets to finish typing. Unset means the model's defaults.
 */
export function babysitTimingFromEnv(
  env: Record<string, string | undefined> = process.env
): { intervalMs?: number; timing?: DeliveryTiming } {
  const read = (name: string): number | undefined => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const debounceMs = read('N10_BABYSIT_DEBOUNCE_MS');
  return {
    intervalMs: read('N10_BABYSIT_POLL_MS'),
    timing: debounceMs === undefined ? undefined : { debounceMs },
  };
}

type Delivery =
  | { outcome: 'injected' | 'spawned' }
  | { outcome: 'held'; held: BabysitHold }
  | { outcome: 'failed'; error: string };

/** Whether the branch can be checked out in `cwd` at all — locally, or
 *  from origin. The checkout below refuses to invent a branch, so this
 *  is what turns a missing one into a hold the badge can explain. */
async function branchAvailable(branch: string, cwd: string): Promise<boolean> {
  return (await refExists(branch, cwd)) || refExists(`origin/${branch}`, cwd);
}

/** Type the update into the live session, if it has been quiet. */
function injectIntoLive(
  opts: PrBabysitterOptions,
  name: string,
  prompt: string
): Delivery {
  if (idleFor(name) < (opts.idleMs ?? BABYSIT_IDLE_MS)) {
    return { outcome: 'held', held: 'agent-busy' };
  }
  return deliverToRunningSession(name, prompt)
    ? { outcome: 'injected' }
    : { outcome: 'failed', error: 'The agent exited while being briefed' };
}

/**
 * Start an agent in the worktree with the update as its opening
 * prompt. Babysitting is opt-in per pull request, and an agent that
 * exits between updates is the normal case, so the next update starts
 * one rather than waiting for the user to notice.
 */
async function spawnForUpdate(
  opts: PrBabysitterOptions,
  pr: PullRequestInfo,
  prompt: string,
  live: () => boolean
): Promise<Delivery> {
  if (!(await branchAvailable(pr.sourceBranch, opts.cwd))) {
    return { outcome: 'held', held: 'branch-unavailable' };
  }
  if (!live()) return { outcome: 'held', held: 'interrupted' };
  // Checkout only: a `createWorktree` that falls back to `-b` would
  // invent a branch of this name off HEAD and start an agent on the
  // wrong base.
  const worktree = await checkoutWorktree(pr.sourceBranch, opts.cwd);
  if (!worktree) {
    return { outcome: 'failed', error: 'Could not create the worktree' };
  }
  // The checkout took time; the repository may have changed under it,
  // or the watch been stopped. A spawn now would run in the wrong
  // repository's terms.
  if (!live()) return { outcome: 'held', held: 'interrupted' };
  const config = opts.getConfig();
  const { cols, rows } = opts.paneSize();
  // `seed`, never `continue-or-seed`: continuing a prior conversation
  // takes the prompt only when there is nothing to continue, and an
  // agent that already worked on this pull request is the normal case.
  const name = worktreeSessionKey(worktree, opts.cwd);
  await launchSession({
    name,
    cwd: worktree,
    branch: pr.sourceBranch,
    cols,
    rows,
    config,
    request: { intent: 'seed', prompt },
  });
  opts.onSpawned?.(name, worktree);
  return { outcome: 'spawned' };
}

/** Hand the update to the agent: typed into its session when one is
 *  running, or as the opening prompt of a new one. */
async function deliver(
  opts: PrBabysitterOptions,
  pr: PullRequestInfo,
  prompt: string,
  live: () => boolean
): Promise<Delivery> {
  const name = await sessionKeyForBranch(pr.sourceBranch, opts.cwd);
  if (!live()) return { outcome: 'held', held: 'interrupted' };
  if (name && opts.isForeignSession?.(name)) {
    return { outcome: 'held', held: 'foreign-session' };
  }
  if (name && isSessionAlive(name)) return injectIntoLive(opts, name, prompt);
  return spawnForUpdate(opts, pr, prompt, live);
}

function initialStatus(pr: PullRequestInfo): BabysitStatus {
  return {
    prId: pr.id,
    sourceBranch: pr.sourceBranch,
    phase: 'watching',
    held: null,
    lastPolledAt: null,
    pendingSince: null,
    lastDeliveredAt: null,
    deliveries: 0,
    lastError: null,
  };
}

export function startPrBabysitter(opts: PrBabysitterOptions): PrBabysitter {
  const { onStatus, isCurrent = () => true, now = Date.now } = opts;
  const fromEnv = babysitTimingFromEnv();
  const intervalMs = opts.intervalMs ?? fromEnv.intervalMs ?? BABYSIT_POLL_MS;
  const timing = opts.timing ?? fromEnv.timing;
  let pr = opts.pr;
  let state: BabysitState = initialBabysitState();
  let remote: RemoteSnapshot | null = null;
  let status = initialStatus(pr);
  let stopped = false;
  // Whether the previous poll found the pull request gone. The list
  // is an eventually consistent search on GitHub, so one absence is
  // not an answer; the watch ends on the second in a row.
  let goneOnce = false;
  let tail: Promise<void> = Promise.resolve();

  const live = () => !stopped && isCurrent();

  const publish = (patch: Partial<BabysitStatus>) => {
    const ended = status.phase === 'ended' || patch.phase === 'ended';
    const phase = state.pendingSince === null ? 'watching' : 'pending';
    const before = statusSignature(status);
    const next = { ...status, ...patch };
    status = {
      ...next,
      pendingSince: state.pendingSince,
      phase: ended ? 'ended' : phase,
      // A hold explains an update that is waiting; once the news has
      // resolved itself, or the watch has ended, there is nothing held.
      held: phase === 'pending' && !ended ? next.held : null,
    };
    // A poll that only moved `lastPolledAt` is not news to anyone
    // showing the status; a shell told about every tick of every
    // watched row would repaint its sidebar once a minute per row.
    if (statusSignature(status) !== before) onStatus(status);
  };

  const end = () => {
    stopped = true;
    clearInterval(timer);
  };

  const maybeDeliver = async (): Promise<void> => {
    if (!isDue(state, now(), timing)) return;
    const taken = takeReport(state, now());
    if (!taken) return;
    const prompt = composeBabysitPrompt(pr, taken.report);
    const delivery = await deliver(opts, pr, prompt, live);
    if (delivery.outcome === 'held') {
      publish({ held: delivery.held });
      return;
    }
    if (delivery.outcome === 'failed') {
      publish({ held: null, lastError: delivery.error });
      return;
    }
    // Only now is the agent deemed to know: a held or failed delivery
    // leaves the baseline alone and the update pending.
    state = taken.state;
    publish({
      held: null,
      lastDeliveredAt: taken.state.lastDeliveredAt,
      deliveries: status.deliveries + 1,
      lastError: null,
    });
  };

  const poll = async (): Promise<void> => {
    if (!live()) return;
    try {
      const lookup = await opts.readPullRequest();
      if (!live()) return;
      if (lookup.kind === 'gone') {
        if (goneOnce) {
          end();
          publish({ phase: 'ended', held: null, lastPolledAt: now() });
        } else {
          goneOnce = true;
          publish({ lastPolledAt: now(), lastError: null });
        }
        return;
      }
      goneOnce = false;
      if (lookup.kind === 'unknown') {
        publish({ lastPolledAt: now(), lastError: lookup.reason });
        return;
      }
      pr = lookup.pr;
      const observed = await observePullRequest({
        pr,
        provider: opts.getProvider(),
        config: opts.getConfig(),
        cwd: opts.cwd,
        previous: remote,
        now: now(),
        refreshMs: opts.remoteRefreshMs,
        live,
      });
      if (!observed) return;
      remote = observed.remote;
      state = observe(state, observed.observation, now());
      publish({ lastPolledAt: now(), lastError: null });
      await maybeDeliver();
    } catch (err: unknown) {
      logError('babysit', err);
      publish({ lastError: err instanceof Error ? err.message : String(err) });
    }
  };

  const enqueue = (): Promise<void> => {
    tail = tail.then(poll).catch(() => undefined);
    return tail;
  };

  const timer = setInterval(() => void enqueue(), intervalMs);
  timer.unref?.();
  void enqueue();

  return {
    pollNow: enqueue,
    status: () => status,
    stop: end,
  };
}
