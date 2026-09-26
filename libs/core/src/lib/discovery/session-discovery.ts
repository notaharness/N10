import { keyForWorktree, sessionIdentity } from '../session-key.js';
/**
 * Noticing worktrees and agent sessions that appear while n10 is
 * running.
 *
 * A session can be created without this process being involved: a
 * second n10, an Orchestra spawn, or someone typing `git worktree add
 * … && tmux new-session -d …` and tagging the result. Nothing pushes
 * that fact at us, so this scans for it — and both shells subscribe to
 * the same scanner rather than each growing their own.
 *
 * **Why polling.** Measured on tmux 3.4, warm, 50 iterations: `git
 * worktree list --porcelain -z` is 2.3 ms and `tmux list-sessions -F` is
 * 3.3 ms, so a scan is two forks and ~5.5 ms — about 0.14% of one core
 * at the four-second default, and flat in the number of worktrees
 * because {@link observeTmuxSessions} answers for the whole set from
 * one listing. The alternatives cost more than they save:
 *
 * - **tmux hooks** (`set-hook -g session-created`) are per-server global
 *   state, so two n10 instances — the very case this feature is
 *   about — overwrite each other's hook unless they append, and an
 *   appended hook cannot be selectively removed afterwards. They also
 *   still need a file or socket to carry the poke back.
 * - **control mode** (`tmux -C`) needs a session to attach to, so it has
 *   nothing to connect to until the first one exists, and an attached
 *   control client *participates in window sizing*: it would resize the
 *   user's agent panes to its own dimensions. `attach-session -f
 *   ignore-size` avoids that, but still needs an existing session.
 *
 * The filesystem watch below is a latency shortcut on top of the poll,
 * not a replacement for it: it makes a new worktree show up as fast as
 * the directory entry appears, and if it cannot be established (the
 * directory does not exist yet, the platform refuses) the interval
 * still covers the same ground.
 */
import { watch, type FSWatcher } from 'node:fs';
import { log, logError } from '@n10/logger';
import { listWorktrees, worktreesBasePath } from '@n10/worktree-manager';
import {
  hasSessionConnection,
  isSessionAlive,
  sessionNames,
} from '../pty-registry.js';
import { observeTmuxSessions } from '../session-backend.js';
import {
  diffScans,
  type DiscoveredTerminal,
  type DiscoveredWorktree,
  type DiscoveryDelta,
  type DiscoveryScan,
} from './discovery-model.js';

/** Default scan cadence. Fast enough that a session started in another
 *  window is there before you have finished switching to this one, slow
 *  enough that the two forks it costs round to nothing. */
export const DISCOVERY_INTERVAL_MS = 4_000;

/** How long to let filesystem events settle before scanning. A single
 *  `git worktree add` emits several. */
const WATCH_DEBOUNCE_MS = 200;

/** How many times an attach may fail before its session is retired.
 *
 *  Not one: the failures worth surviving are transient — a
 *  `git worktree add` losing to an `index.lock`, a momentarily busy
 *  repository — and giving up on the first would lose the session for
 *  the life of the process over a hiccup, silently. Not unbounded
 *  either: a deterministic failure would then be a spawn attempt every
 *  tick forever. Retries are a scan apart, so this is seconds of
 *  patience, not milliseconds. */
const MAX_ADOPT_ATTEMPTS = 3;

/**
 * Whether a scan is worth telling the shells about.
 *
 * Not `delta.changed`, which counts sessions *offered* for attaching:
 * an offer that lost its race with the user, or with a repo switch
 * mid-loop, changed nothing that a refetch would show. The shells
 * answer this by re-reading git and the registry, so a `true` nobody
 * needed is a fork and a re-render for no reason — every four seconds,
 * for as long as the process runs.
 */
function worthAnnouncing(delta: DiscoveryDelta, adopted: number): boolean {
  return (
    adopted > 0 ||
    delta.appeared.length > 0 ||
    delta.disappeared.length > 0 ||
    delta.switched.length > 0 ||
    delta.ended.length > 0 ||
    delta.endedTerminals.length > 0
  );
}

export interface SessionDiscoveryOptions {
  /** Scan cadence in ms. */
  intervalMs?: number;
  /**
   * Attach to an external session, through whatever launch path the
   * shell normally uses — which must reach `spawnSession`, so the tmux
   * backend resolves the running agent by its tags and attaches to it
   * rather than starting a second one.
   *
   * Rejecting marks the name as failed and stops it being offered
   * again until its tmux session goes away, so a session that cannot be
   * attached to does not become a spawn loop.
   */
  adopt: (worktree: DiscoveredWorktree) => void | Promise<void>;
  /**
   * Attach to a terminal-tab session, the same way: through the
   * shell's launch path, under the name and in the directory tmux
   * reported. A shell with no terminal tabs leaves this unset, and the
   * scan then does not look for terminals at all — offering them to
   * nobody would only report the world as changed every tick.
   */
  adoptTerminal?: (terminal: DiscoveredTerminal) => void | Promise<void>;
  /** Something changed and the shell's session list is out of date. */
  onChanged: (delta: DiscoveryDelta) => void;
  /** Returning false abandons a scan between steps. The desktop can
   *  open another repository mid-scan, and finishing against the new
   *  one would attach this repo's branch names over there. */
  isCurrent?: () => boolean;
}

export interface SessionDiscovery {
  /** Scan immediately rather than waiting for the next tick. Resolves
   *  when the scan (and any attaches it triggered) has finished. */
  scanNow(): Promise<void>;
  /** Stop scanning and release the watch. Idempotent. */
  stop(): void;
}

/**
 * Start watching for externally created worktrees and sessions.
 *
 * The returned handle is the only way to stop it; callers own exactly
 * one per open repository and must stop it before starting another, or
 * two scanners will attach the same sessions.
 */
export function startSessionDiscovery(
  opts: SessionDiscoveryOptions
): SessionDiscovery {
  const { adopt, adoptTerminal, onChanged, isCurrent = () => true } = opts;
  const intervalMs = opts.intervalMs ?? DISCOVERY_INTERVAL_MS;

  let previous: DiscoveryScan | null = null;
  /** Consecutive failed attaches per session name. An entry is dropped
   *  when the tmux session behind it goes away, so a later session
   *  under the same name starts with a clean slate. */
  const failures = new Map<string, number>();
  /** Names that have failed {@link MAX_ADOPT_ATTEMPTS} times and are no
   *  longer offered. Handed to `diffScans` rather than filtered after
   *  it, so a retired name cannot keep reporting the world as changed. */
  const retired = new Set<string>();
  let stopped = false;
  /** Resolves when the last scheduled scan has finished. Everything is
   *  chained off it, which is what keeps two from overlapping. */
  let tail: Promise<void> = Promise.resolve();
  /** A scan that is scheduled but has not started looking yet. */
  let pending: Promise<void> | null = null;
  let watcher: FSWatcher | null = null;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;

  async function observe(): Promise<DiscoveryScan> {
    const worktrees: DiscoveredWorktree[] = (await listWorktrees()).map(
      (wt) => ({
        name: keyForWorktree(wt),
        branch: wt.branch,
        path: wt.path,
      })
    );
    const seen = observeTmuxSessions(worktrees);
    return {
      worktrees,
      persisted: seen.persisted,
      terminals: adoptTerminal ? seen.terminals : [],
    };
  }

  /** One attach, through the shell. Reports whether it took. */
  async function adoptOne<T extends { name: string }>(
    item: T,
    attach: (item: T) => void | Promise<void>
  ): Promise<boolean> {
    // Re-checked here, not once in `diffScans`: an earlier attach in
    // the same loop can take long enough for the user to launch this
    // session themselves, and handing a live one to `spawnSession`
    // disposes the PTY and emulator behind the pane they are looking at.
    if (isSessionAlive(item.name) && hasSessionConnection(item.name))
      return false;
    try {
      await attach(item);
      failures.delete(item.name);
      log('info', 'discovery', `attached external session ${item.name}`);
      return true;
    } catch (err: unknown) {
      const attempts = (failures.get(item.name) ?? 0) + 1;
      failures.set(item.name, attempts);
      if (attempts >= MAX_ADOPT_ATTEMPTS) retired.add(item.name);
      logError('discovery', err);
      return false;
    }
  }

  /** Attach to what the delta offered, one at a time, and report how
   *  many actually attached. Sequential because each one spawns a PTY,
   *  and because the repo can change underneath a slow one. */
  async function adoptAll(delta: DiscoveryDelta): Promise<number> {
    const offers = [
      ...delta.adoptable.map((wt) => () => adoptOne(wt, adopt)),
      ...delta.adoptableTerminals.map(
        (t) => () => adoptOne(t, adoptTerminal ?? (() => undefined))
      ),
    ];
    let adopted = 0;
    for (const offer of offers) {
      if (stopped || !isCurrent()) return adopted;
      if (await offer()) adopted += 1;
    }
    return adopted;
  }

  /** A name only carries its failures while the session it failed on is
   *  still there; once tmux has dropped it, a new one under the same
   *  name deserves a clean try. Run before the diff, so a returning
   *  session is offered on the very scan that finds it. */
  function forgetFailuresFor(next: DiscoveryScan): void {
    const live = new Set(next.terminals.map((t) => t.name));
    for (const name of [...failures.keys()]) {
      if (next.persisted.has(name) || live.has(name)) continue;
      failures.delete(name);
      retired.delete(name);
    }
  }

  async function runScan(): Promise<void> {
    if (stopped || !isCurrent()) return;
    const next = await observe();
    if (stopped || !isCurrent()) return;
    forgetFailuresFor(next);
    const delta = diffScans(
      previous,
      next,
      (name) => isSessionAlive(name) && hasSessionConnection(name),
      retired,
      hasSessionConnection
    );
    // A repo switch starts a fresh scanner, but terminal tabs are process-global.
    // Reconcile held terminal keys too, including final frames from an earlier scan.
    if (adoptTerminal) {
      const present = new Set(next.terminals.map((terminal) => terminal.name));
      delta.endedTerminals = [
        ...new Set([
          ...delta.endedTerminals,
          ...sessionNames().filter(
            (name) =>
              sessionIdentity(name)?.kind === 'terminal' && !present.has(name)
          ),
        ]),
      ];
    }
    previous = next;
    // Attach first, announce second: the shell answers `changed` by
    // re-reading the registry, and it must see the sessions this scan
    // just adopted rather than the state from before them.
    const adopted = await adoptAll(delta);
    if (worthAnnouncing(delta, adopted) && !stopped && isCurrent()) {
      onChanged(delta);
    }
    ensureWatch();
  }

  /**
   * Never two at once, and never a dropped request.
   *
   * Whatever prompted a call happened after any scan already in
   * progress had looked, so that one cannot answer it — the returned
   * promise settles only once a scan that started at or after the call
   * has finished. A scan that is merely *scheduled* has not looked yet,
   * so further callers join it rather than stacking up more; they would
   * all observe the same state anyway.
   */
  function scanNow(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    const scan = tail
      .then(() => {
        // Starting now, so it can no longer answer for a later caller.
        pending = null;
        return stopped ? undefined : runScan();
      })
      // A scan runs on a timer with nobody to report to, and an
      // unhandled rejection here would end the process.
      .catch((err: unknown) => logError('discovery', err));
    pending = scan;
    tail = scan;
    return scan;
  }

  /** Watch the one directory worktrees are created in — not the
   *  checkouts inside it. A recursive watch over a working tree wants
   *  an inotify handle per directory and `node_modules` alone exhausts
   *  the Linux default. */
  function ensureWatch(): void {
    if (watcher || stopped) return;
    try {
      watcher = watch(
        worktreesBasePath(),
        { persistent: false, recursive: false },
        () => {
          if (watchTimer || stopped) return;
          watchTimer = setTimeout(() => {
            watchTimer = null;
            void scanNow();
          }, WATCH_DEBOUNCE_MS);
        }
      );
      // A watch on a directory that is later deleted errors rather than
      // going quiet. Drop it and let the next scan re-establish one.
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      // Nothing to watch yet — no worktree has ever been created here,
      // or the platform will not watch this path. The interval covers
      // it, and every scan tries again.
      watcher = null;
    }
  }

  const timer = setInterval(() => void scanNow(), intervalMs);
  // Never a reason to hold the process open: discovery is something the
  // app does while it is running, not work that has to finish.
  timer.unref?.();
  ensureWatch();
  void scanNow();

  return {
    scanNow,
    stop() {
      stopped = true;
      clearInterval(timer);
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = null;
      watcher?.close();
      watcher = null;
    },
  };
}
