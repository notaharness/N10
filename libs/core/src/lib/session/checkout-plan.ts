import { getRepoRoot } from '../repo-root.js';
import { worktreeSessionKey } from '../session-key.js';
import { sessionKeyForBranch } from '../worktree-rows.js';
import type { AppConfig, PullRequestInfo } from '@n10/vcs-core';
import { createWorktree } from '@n10/worktree-manager';
import { isSessionAlive, hasSessionConnection } from '../pty-registry.js';
import { hasLiveTmuxSession } from '../session-backend.js';
import { stopSession } from './stop-session.js';
import { launchSession, deliverToRunningSession } from './launch-session.js';

// ── Checkout orchestration ───────────────────────────────────────
//
// Forwards a composed plan prompt to the configured agent in the PR's
// own worktree. Three states (always one agent per worktree):
//
//   A. Agent already running → inject (typed into the REPL,
//      non-destructive) OR new-session (kill old + respawn), per `mode`.
//   B. Worktree exists, no agent → spawn seeded with the plan.
//   C. No worktree → create it, then spawn seeded with the plan.
//
// States B and C are unified because `createWorktree` is idempotent —
// it returns the existing path in B and creates one in C.
//
// The spawn uses the `seed` intent, never `continue`: continuing a prior
// conversation would swallow the plan, and delivering the plan is the
// whole point of checkout. The launcher hands the prompt to the agent as
// argv (or env), so no shell quoting is involved.

export type CheckoutResult = 'injected' | 'spawned' | 'failed';

export interface CheckoutDeps {
  repo?: string;
  pr: PullRequestInfo;
  /** Composed plan prompt (see composePlanPrompt). */
  prompt: string;
  paneCols: number;
  paneRows: number;
  /** Only meaningful in State A (a running agent is present). */
  mode: 'inject' | 'new-session';
  /** Drives which agent is launched. */
  config: AppConfig;
  flashStatus: (msg: string) => void;
}

/** State A, inject: attach to the running agent if this process holds
 *  no live connection to it, then type the plan into it. */
async function inject(
  deps: CheckoutDeps,
  repo: string,
  name: string
): Promise<CheckoutResult> {
  const { pr, prompt, paneCols, paneRows, config, flashStatus } = deps;
  if (!isSessionAlive(name) || !hasSessionConnection(name)) {
    const cwd = await createWorktree(pr.sourceBranch, repo);
    if (!cwd) return 'failed';
    await launchSession({
      name: worktreeSessionKey(cwd, repo),
      cwd,
      cols: paneCols,
      rows: paneRows,
      config,
      mode: 'attach',
      request: { intent: 'blank' },
    });
  }
  if (!deliverToRunningSession(name, prompt)) {
    flashStatus('Agent is no longer running');
    return 'failed';
  }
  return 'injected';
}

export async function checkoutPlan(
  deps: CheckoutDeps
): Promise<CheckoutResult> {
  const { pr, prompt, paneCols, paneRows, mode, config, flashStatus } = deps;
  const repo = deps.repo ?? getRepoRoot() ?? process.cwd();
  // The agent in the checkout that has the PR's branch, when there is
  // one; a spawn below keys by the checkout it lands in.
  const name = await sessionKeyForBranch(pr.sourceBranch, repo);

  const seed = (cwd: string) =>
    launchSession({
      name: worktreeSessionKey(cwd, repo),
      cwd,
      branch: pr.sourceBranch,
      cols: paneCols,
      rows: paneRows,
      config,
      request: { intent: 'seed', prompt },
    });

  // ── State A: an agent is already running in this worktree ──
  if (name && (isSessionAlive(name) || hasLiveTmuxSession(name))) {
    if (mode === 'inject') return inject(deps, repo, name);
    // An explicit new session terminates the old agent before seeding a replacement.
    const worktreePath = await createWorktree(pr.sourceBranch, repo);
    if (!worktreePath) {
      flashStatus(`Failed to resolve worktree for ${pr.sourceBranch}`);
      return 'failed';
    }
    stopSession(name);
    await seed(worktreePath);
    return 'spawned';
  }

  // ── States B & C: no running agent — ensure a worktree, then spawn ──
  const worktreePath = await createWorktree(pr.sourceBranch, repo);
  if (!worktreePath) {
    flashStatus(`Failed to create worktree for ${pr.sourceBranch}`);
    return 'failed';
  }
  await seed(worktreePath);
  return 'spawned';
}
