import type { Line } from '@/components/demo/term';

/**
 * What a scripted Claude Code session is made of. A script is a list
 * of beats on the session's own clock; each beat adds blocks to the
 * transcript and may change what the sidebar shows about the session.
 * The view at any moment is derived from the elapsed time alone (see
 * claudeAt), so a session keeps "working" while its tab is hidden and
 * reduced motion simply jumps the clock to the end.
 */
export type Block =
  | { kind: 'banner'; cwd: string }
  /** A turn from the user, or from n10 typing into the session. */
  | { kind: 'prompt'; lines: readonly string[] }
  /** `● Bash(npm test)` and its result under `⎿`. */
  | { kind: 'tool'; name: string; arg: string; out?: readonly Line[] }
  /** A collapsed group, like `Read 2 files (ctrl+o to expand)`. */
  | { kind: 'collapsed'; text: string }
  | {
      kind: 'edit';
      verb: 'Update' | 'Write';
      path: string;
      note: string;
      rows: readonly DiffRow[];
    }
  /** Claude's own text: paragraphs with `code` and **bold**. */
  | { kind: 'say'; paragraphs: readonly string[] }
  /** The line left behind when a turn ends, like `✻ Brewed for 31s`. */
  | { kind: 'done'; text: string }
  | { kind: 'interrupted' };

export interface DiffRow {
  n?: number;
  sign: '+' | '-' | ' ' | '…';
  code?: string;
}

export type AgentState = 'working' | 'input' | 'idle';
export type Ci = 'failed' | 'running' | 'passed';

/** A permission prompt. The session's clock holds here until answered. */
export interface Gate {
  command: string;
  why: string;
  options: readonly string[];
  /** The option that declines; the turn ends there. */
  reject: number;
}

export interface Beat {
  at: number;
  blocks?: readonly Block[];
  /** Starts the spinner line with this verb; null stops it. */
  working?: string | null;
  state?: AgentState;
  ci?: Ci;
  unresolved?: number;
  /** Read out to screen readers when the beat plays. */
  announce?: string;
  gate?: Gate;
}

/** A block and a key that stays put as the transcript grows. */
export interface Placed {
  id: string;
  block: Block;
}

export interface ClaudeView {
  blocks: Placed[];
  /** The spinner's verb and when it started, while Claude is working. */
  working: { verb: string; since: number } | null;
  state: AgentState;
  ci?: Ci;
  unresolved?: number;
  gate: Gate | null;
  announce?: string;
}

/** Undefined while unanswered, else the chosen option's index. */
export type Answer = number | undefined;

function gateIndex(beats: readonly Beat[]): number {
  return beats.findIndex((b) => b.gate);
}

/** Beats that can play given the answer so far. */
function playable(beats: readonly Beat[], answer: Answer): readonly Beat[] {
  const g = gateIndex(beats);
  if (g < 0 || (answer !== undefined && answer !== beats[g]?.gate?.reject)) {
    return beats;
  }
  return beats.slice(0, g + 1);
}

/** Whether the session has a permission prompt still to answer. */
export function awaitsAnswer(beats: readonly Beat[], answer: Answer): boolean {
  return gateIndex(beats) >= 0 && answer === undefined;
}

/** How far the session's clock may run: to its gate, or to its end. */
export function capOf(beats: readonly Beat[], answer: Answer): number {
  const open = playable(beats, answer);
  return open[open.length - 1]?.at ?? 0;
}

function apply(view: ClaudeView, beat: Beat): ClaudeView {
  const placed = (beat.blocks ?? []).map((block, j) => ({
    id: `${beat.at}.${j}`,
    block,
  }));
  const next = { ...view, blocks: [...view.blocks, ...placed] };
  if (beat.working !== undefined) {
    next.working = beat.working ? { verb: beat.working, since: beat.at } : null;
  }
  if (beat.state) next.state = beat.state;
  if (beat.ci) next.ci = beat.ci;
  if (beat.unresolved !== undefined) next.unresolved = beat.unresolved;
  if (beat.announce) next.announce = beat.announce;
  return next;
}

export function claudeAt(
  beats: readonly Beat[],
  t: number,
  answer: Answer
): ClaudeView {
  let view: ClaudeView = {
    blocks: [],
    working: null,
    state: 'idle',
    gate: null,
  };
  const open = playable(beats, answer);
  for (const beat of open) {
    if (beat.at > t) break;
    view = apply(view, beat);
    if (beat.gate) view = answered(view, beat.gate, answer);
  }
  return view;
}

function answered(view: ClaudeView, gate: Gate, answer: Answer): ClaudeView {
  if (answer === undefined) {
    return { ...view, gate, working: null, state: 'input' };
  }
  if (answer !== gate.reject) return view;
  return {
    ...view,
    blocks: [
      ...view.blocks,
      { id: 'interrupted', block: { kind: 'interrupted' } },
    ],
    working: null,
    state: 'idle',
  };
}
