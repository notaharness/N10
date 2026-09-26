import { sessionForBranch } from '@n10/core';
import type { KeyPress, PlanItem } from '@n10/core';
import {
  hasSession,
  checkoutPlan,
  composePlanPrompt,
  planItemKey,
} from '@n10/core';

import { handlePlanAnnotateInput } from '../../utils/plan-annotate-mode.js';
import type { PlanCheckoutHandlerCtx } from './input-types.js';

// Interactive checkout pane input.
//
// Three modes, checked in order:
//   1. Annotation composer (annotatingPlanKey set) — edit a note.
//   2. Target choice (planCheckoutTarget set) — inject vs new-session,
//      shown only when an agent is already running in the worktree.
//   3. Checklist navigation — move/toggle-include/annotate/send/back.

// ── Mode 2: target choice ─────────────────────────────────────────

/** The target prompt is a two-row radio, so its actions need nothing
 *  beyond the answer currently highlighted. */
interface PlanTargetActionCtx {
  ctx: PlanCheckoutHandlerCtx;
  target: 'inject' | 'new-session';
}

/** Two rows, so up and down are the same flip. */
function flipTarget({ ctx, target }: PlanTargetActionCtx): void {
  ctx.pane.setPlanCheckoutTarget(
    target === 'inject' ? 'new-session' : 'inject'
  );
}

const PLAN_TARGET_ACTIONS: Record<string, (a: PlanTargetActionCtx) => void> = {
  'plan-checkout.back': ({ ctx }) => {
    ctx.pane.setPlanCheckoutTarget(null);
  },
  'plan-checkout.navigate-up': flipTarget,
  'plan-checkout.navigate-down': flipTarget,
  'plan-checkout.send': ({ ctx, target }) => {
    runCheckout(ctx, target);
  },
};

// ── Mode 3: checklist ─────────────────────────────────────────────

/** Everything a checklist action needs, computed once per keypress. */
interface PlanCheckoutActionCtx {
  ctx: PlanCheckoutHandlerCtx;
  /** The open PR's plan; empty when no PR is selected. */
  items: PlanItem[];
  /** The row the cursor is on, if there is one. */
  selected: PlanItem | undefined;
}

function back({ ctx }: PlanCheckoutActionCtx): void {
  ctx.pane.setPaneMode(ctx.pane.priorPaneMode);
}

function navigateDown({ ctx, items }: PlanCheckoutActionCtx): void {
  ctx.pane.setPlanCheckoutIndex((i) => Math.min(i + 1, items.length - 1));
}

function navigateUp({ ctx }: PlanCheckoutActionCtx): void {
  ctx.pane.setPlanCheckoutIndex((i) => Math.max(i - 1, 0));
}

/** Toggle-include here means "drop from the plan" — the plan IS the
 *  cart, so excluding an item removes it. Keeps the top-right
 *  indicator truthful. */
function dropSelected({ ctx, selected }: PlanCheckoutActionCtx): void {
  const prId = ctx.selectedPr?.id;
  if (!selected || prId == null) return;
  ctx.plan.remove(prId, selected.kind, selected.id);
  const remaining = ctx.plan.count(prId);
  if (remaining === 0) {
    // Nothing left — bail back to where we came from.
    ctx.pane.setPaneMode(ctx.pane.priorPaneMode);
    return;
  }
  ctx.pane.setPlanCheckoutIndex((i) => Math.min(i, remaining - 1));
}

function annotateSelected({ ctx, selected }: PlanCheckoutActionCtx): void {
  if (!selected) return;
  ctx.pane.setAnnotatingPlanKey(planItemKey(selected.kind, selected.id));
  ctx.pane.setAnnotationBuffer(selected.annotation ?? '');
}

function send({ ctx, items }: PlanCheckoutActionCtx): void {
  const { selectedPr } = ctx;
  if (!selectedPr || selectedPr.id == null || items.length === 0) {
    ctx.sessions.flashStatus('Plan is empty');
    return;
  }
  // The selected row's session is the one in the checkout on the PR's
  // branch, when there is one.
  const name = ctx.sidebar.sessionNameForTerminal;
  if (name && hasSession(name)) {
    // An agent is running — ask how to deliver. Default to inject
    // (non-destructive).
    ctx.pane.setPlanCheckoutTarget('inject');
    return;
  }
  // No running agent — spawn straight away (states B/C).
  runCheckout(ctx, 'new-session');
}

const PLAN_CHECKOUT_ACTIONS: Record<
  string,
  (a: PlanCheckoutActionCtx) => void
> = {
  'plan-checkout.back': back,
  'plan-checkout.navigate-down': navigateDown,
  'plan-checkout.navigate-up': navigateUp,
  'plan-checkout.toggle-include': dropSelected,
  'plan-checkout.annotate': annotateSelected,
  'plan-checkout.send': send,
};

export function handlePlanCheckoutInput(
  input: string,
  key: KeyPress,
  ctx: PlanCheckoutHandlerCtx
): void {
  const { pane, plan, selectedPr } = ctx;
  const prId = selectedPr?.id;

  // ── 1. Annotation composer ──
  if (handlePlanAnnotateInput(input, key, { pane, plan, prId })) {
    return;
  }

  const action = ctx.keybinds.resolve(input, key, 'plan-checkout');
  if (!action) return;

  // ── 2. Inject-vs-new-session choice ──
  // Modal: an action the prompt has no answer for is swallowed rather
  // than falling through to the checklist behind it.
  if (pane.planCheckoutTarget) {
    PLAN_TARGET_ACTIONS[action]?.({ ctx, target: pane.planCheckoutTarget });
    return;
  }

  // ── 3. Checklist navigation ──
  const items = prId != null ? plan.list(prId) : [];
  PLAN_CHECKOUT_ACTIONS[action]?.({
    ctx,
    items,
    selected: items[pane.planCheckoutIndex],
  });
}

function runCheckout(
  ctx: PlanCheckoutHandlerCtx,
  mode: 'inject' | 'new-session'
): void {
  const { pane, plan, selectedPr } = ctx;
  if (!selectedPr) return;
  const prId = selectedPr.id;
  const items = plan.list(prId);
  if (items.length === 0) {
    ctx.sessions.flashStatus('Plan is empty');
    return;
  }
  const prompt = composePlanPrompt(items);

  void ctx.asyncOps.run('start-session', async () => {
    const result = await checkoutPlan({
      pr: selectedPr,
      prompt,
      paneCols: ctx.terminal.paneCols,
      paneRows: ctx.terminal.paneRows,
      mode,
      config: ctx.config.config,
      flashStatus: ctx.sessions.flashStatus,
    });
    if (result === 'failed') {
      // Leave the plan intact so the user can retry.
      pane.setPlanCheckoutTarget(null);
      return;
    }

    plan.clear(prId);
    const rows = await ctx.sessions.refreshSessions();
    const name = sessionForBranch(rows, selectedPr.sourceBranch)?.name;
    if (name) ctx.sidebar.selectByKey(`session:${name}`);
    ctx.sessions.flashStatus(
      result === 'injected' ? 'Plan sent to agent' : 'Agent started with plan'
    );
    pane.setPlanCheckoutTarget(null);
    pane.setPaneMode('terminal');
    ctx.nav.setFocus('terminal');
    ctx.pane.setReconnectKey((k) => k + 1);
  });
}
