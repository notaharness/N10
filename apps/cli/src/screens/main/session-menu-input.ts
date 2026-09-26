import {
  handleTextInput,
  type KeyPress,
  isSessionAlive,
  launchSession,
  worktreeSessionKey,
  buildReviewLaunchRequest,
  buildAgentOptions,
  sessionMenuOptions,
  cycleAgentIndex,
  type SessionMenuOptionKey,
} from '@n10/core';
import { createWorktree, listWorktrees } from '@n10/worktree-manager';
import type { SessionMenuHandlerCtx } from './input-types.js';
import { resolveEditorTarget } from './editor-target.js';

// Session menu input. The menu opens on any sidebar row whose agent is
// not running (Tab/Enter from the sidebar, or right after the branch
// picker creates a worktree). Rows: start/continue with a per-launch
// agent choice, and — when the row has a PR — start a review, with or
// without extra instructions.

// ── Shared steps ─────────────────────────────────────────────────

/** Dismiss the menu; PR rows fall back to their detail pane. */
function closeMenu(ctx: SessionMenuHandlerCtx): void {
  const hadPr = ctx.pane.sessionMenu?.pr != null;
  ctx.pane.setSessionMenu(null);
  ctx.pane.setReviewInstruction('');
  ctx.pane.setPaneMode(hadPr ? 'pr-detail' : 'terminal');
}

/**
 * Spawn (unless the agent is already alive — an exited one is
 * relaunched), then refresh and move focus into the started terminal.
 * `launch` answers the session it started — keyed by the checkout it
 * landed in, which a PR row without a worktree only has once the launch
 * has created one — or null to abort without focusing: no worktree, or
 * the worktree could not be created.
 */
function runStart(
  ctx: SessionMenuHandlerCtx,
  launch: () => Promise<string | null>
): void {
  void ctx.asyncOps.run('start-session', async () => {
    const current = ctx.sessionNameForTerminal;
    const name = current && isSessionAlive(current) ? current : await launch();
    if (!name) return;
    await ctx.sessions.refreshSessions();
    if (ctx.selectedItem?.kind !== 'review-pr') {
      ctx.sidebar.selectByKey(`session:${name}`);
    }
    ctx.pane.setPaneMode('terminal');
    ctx.nav.setFocus('terminal');
    ctx.pane.setReconnectKey((k) => k + 1);
    ctx.pane.setSessionMenu(null);
    ctx.pane.setReviewInstruction('');
  });
}

/**
 * Start the agent picked in the menu. Session rows always have a
 * worktree (whatever its directory name); PR rows without one get it
 * created on demand — the same resolution the editor shortcut uses.
 */
async function launchSelectedAgent(
  ctx: SessionMenuHandlerCtx
): Promise<string | null> {
  const item = ctx.selectedItem;
  const worktreePath = item
    ? await resolveEditorTarget(item, { listWorktrees, createWorktree })
    : null;
  if (!worktreePath) {
    ctx.sessions.flashStatus('No worktree found for selected session');
    return null;
  }
  const options = buildAgentOptions(ctx.config.config);
  const wanted = ctx.pane.sessionMenu?.agentIndex ?? 0;
  const idx = Math.min(Math.max(wanted, 0), options.length);
  // Automatic uses the recorded agent; every named choice starts fresh.
  const name = worktreeSessionKey(worktreePath);
  await launchSession({
    name,
    cwd: worktreePath,
    ...(item?.kind === 'session' ? {} : { branch: item?.pr.sourceBranch }),
    cols: ctx.terminal.paneCols,
    rows: ctx.terminal.paneRows,
    config: ctx.config.config,
    agent: idx === 0 ? undefined : options[idx - 1]!.agent,
    request: { intent: idx === 0 ? 'continue-or-blank' : 'blank' },
    fresh: idx !== 0,
  });
  return name;
}

/**
 * Start (or resume) an AI review of the row's PR. The prompt is
 * delivered as argv/env by the launcher — never composed into a shell
 * string — so quotes in the PR title survive intact.
 */
async function launchReview(
  ctx: SessionMenuHandlerCtx,
  instruction?: string
): Promise<string | null> {
  const pr = ctx.pane.sessionMenu?.pr;
  if (!pr) return null;
  const worktreePath = await createWorktree(pr.sourceBranch);
  if (!worktreePath) {
    ctx.sessions.flashStatus(
      `Failed to create worktree for ${pr.sourceBranch}`
    );
    return null;
  }
  const name = worktreeSessionKey(worktreePath);
  await launchSession({
    name,
    cwd: worktreePath,
    branch: pr.sourceBranch,
    cols: ctx.terminal.paneCols,
    rows: ctx.terminal.paneRows,
    config: ctx.config.config,
    request: buildReviewLaunchRequest(pr, instruction),
  });
  return name;
}

// Updater form throughout: arrow presses bunched into one stdin chunk
// are delivered against a single render snapshot, and each must still
// advance exactly one step.

function moveSelection(
  ctx: SessionMenuHandlerCtx,
  step: 1 | -1,
  count: number
): void {
  ctx.pane.setSessionMenu(
    (prev) =>
      prev && {
        ...prev,
        selectedOption: Math.min(
          Math.max(prev.selectedOption + step, 0),
          count - 1
        ),
      }
  );
}

function cycleAgent(ctx: SessionMenuHandlerCtx, step: 1 | -1): void {
  const count = buildAgentOptions(ctx.config.config).length + 1;
  ctx.pane.setSessionMenu(
    (prev) =>
      prev && {
        ...prev,
        agentIndex: cycleAgentIndex(prev.agentIndex, step, count),
      }
  );
}

// ── Dispatch ─────────────────────────────────────────────────────

/** What Enter does on each row. */
const SELECT_BY_ROW: Record<
  SessionMenuOptionKey,
  (ctx: SessionMenuHandlerCtx) => void
> = {
  start: (ctx) => runStart(ctx, () => launchSelectedAgent(ctx)),
  review: (ctx) => runStart(ctx, () => launchReview(ctx)),
  instructions: (ctx) =>
    runStart(ctx, () =>
      launchReview(ctx, ctx.pane.reviewInstruction || undefined)
    ),
  cancel: closeMenu,
};

interface MenuActionCtx {
  ctx: SessionMenuHandlerCtx;
  /** The highlighted row. */
  optKey: SessionMenuOptionKey;
  /** How many rows the menu has for this item. */
  optionCount: number;
}

/** The agent picker is rendered on the start row, so it only cycles there. */
function cycleOnStartRow(step: 1 | -1) {
  return ({ ctx, optKey }: MenuActionCtx) => {
    if (optKey === 'start') cycleAgent(ctx, step);
  };
}

const MENU_ACTIONS: Record<string, (a: MenuActionCtx) => void> = {
  'confirm.cancel': ({ ctx }) => closeMenu(ctx),
  'confirm.navigate-down': ({ ctx, optionCount }) =>
    moveSelection(ctx, 1, optionCount),
  'confirm.navigate-up': ({ ctx, optionCount }) =>
    moveSelection(ctx, -1, optionCount),
  'confirm.select': ({ ctx, optKey }) => SELECT_BY_ROW[optKey](ctx),
  'confirm.cycle-agent-left': cycleOnStartRow(-1),
  'confirm.cycle-agent-right': cycleOnStartRow(1),
};

export function handleSessionMenuInput(
  input: string,
  key: KeyPress,
  ctx: SessionMenuHandlerCtx
): void {
  const menu = ctx.pane.sessionMenu;
  if (!menu) return;
  const options = sessionMenuOptions(menu.pr != null);
  const optKey = options[Math.min(menu.selectedOption, options.length - 1)]!;

  // Instructions row: Enter submits, and text input takes precedence
  // over bindings so any printable character (including j/k under the
  // vim preset) lands in the buffer. Arrows and Esc are not printable,
  // so navigation and cancel still resolve below.
  if (optKey === 'instructions') {
    if (key.return) {
      SELECT_BY_ROW.instructions(ctx);
      return;
    }
    if (handleTextInput(input, key, ctx.pane.setReviewInstruction)) return;
  }

  const action = ctx.keybinds.resolve(input, key, 'confirm');
  if (!action) return;
  MENU_ACTIONS[action]?.({ ctx, optKey, optionCount: options.length });
}
