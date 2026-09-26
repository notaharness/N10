import { BEAM_COLORS } from '@/components/beam/mesh/palette';

export type Kind = 'PROGRESS' | 'QUESTION' | 'BLOCKED' | 'DONE';
export type Status = 'working' | 'question' | 'blocked' | 'done';

export const KIND_COLOR: Record<Kind, string> = {
  PROGRESS: BEAM_COLORS.sage,
  QUESTION: BEAM_COLORS.sand,
  BLOCKED: BEAM_COLORS.clay,
  DONE: BEAM_COLORS.blue,
};

export type Machine = 'tower' | 'mini' | 'rack' | 'laptop';

export interface PlayerSpec {
  id: string;
  session: string;
  branch: string;
  agent: string;
  machine: Machine;
  /** Degrees around the arc below the laptop, 90 being straight below. */
  angle: number;
  color: string;
}

export const PLAYERS: PlayerSpec[] = [
  {
    id: 'a',
    session: 'shop-feature-search',
    branch: 'feature/search',
    agent: 'claude',
    machine: 'tower',
    angle: 158,
    color: BEAM_COLORS.sage,
  },
  {
    id: 'b',
    session: 'shop-fix-flaky-restore',
    branch: 'fix/flaky-restore',
    agent: 'codex',
    machine: 'rack',
    angle: 124,
    color: BEAM_COLORS.sand,
  },
  {
    id: 'c',
    session: 'shop-feature-palette',
    branch: 'feature/palette',
    agent: 'claude',
    machine: 'mini',
    angle: 90,
    color: BEAM_COLORS.clay,
  },
  {
    id: 'd',
    session: 'shop-chore-deps',
    branch: 'chore/deps',
    agent: 'gemini',
    machine: 'laptop',
    angle: 56,
    color: BEAM_COLORS.blue,
  },
  {
    id: 'e',
    session: 'shop-feature-export',
    branch: 'feature/export',
    agent: 'codex',
    machine: 'tower',
    angle: 22,
    color: BEAM_COLORS.mauve,
  },
];

export type Event =
  | { t: number; player: string; report: Kind; text: string }
  | { t: number; player: string; reply: string }
  | { t: number; player: string; assign: string };

/** One loop of the stage, in seconds. Players start out all working. */
export const SCRIPT: Event[] = [
  {
    t: 1.5,
    player: 'c',
    report: 'QUESTION',
    text: 'two palettes exist — extend the theme tokens, or add a third set?',
  },
  {
    t: 4,
    player: 'c',
    reply:
      'extend the tokens; a third set is what we are trying to get rid of.',
  },
  {
    t: 6,
    player: 'a',
    report: 'PROGRESS',
    text: 'indexer wired to the sidebar, 14 tests green, draft PR #128 open.',
  },
  {
    t: 8.5,
    player: 'e',
    report: 'BLOCKED',
    text: 'no S3 credentials on this machine; export.spec.ts cannot run.',
  },
  {
    t: 11,
    player: 'e',
    reply:
      'use the fixture bucket in test/fixtures/s3 — no credentials needed.',
  },
  {
    t: 13.5,
    player: 'b',
    report: 'DONE',
    text: 'root cause was a race in restore(); fixed with a regression test. PR #131 ready.',
  },
  {
    t: 16.5,
    player: 'b',
    assign: 'add a retry budget to sync so a flaky remote cannot spin forever.',
  },
  {
    t: 19,
    player: 'd',
    report: 'PROGRESS',
    text: 'lockfile bumped, only one peer-dep warning left.',
  },
  {
    t: 22,
    player: 'a',
    report: 'QUESTION',
    text: 'search results: should the sidebar filter live, or on Enter?',
  },
  { t: 24.5, player: 'a', reply: 'live, debounced at 150 ms.' },
  {
    t: 27,
    player: 'd',
    report: 'DONE',
    text: 'deps current, CI green across the matrix. PR #133.',
  },
  {
    t: 30,
    player: 'd',
    assign: 'move the e2e fixtures onto the new tmux socket helper.',
  },
  {
    t: 32.5,
    player: 'e',
    report: 'PROGRESS',
    text: 'export works against the fixture bucket; wiring the progress bar.',
  },
  {
    t: 35.5,
    player: 'c',
    report: 'DONE',
    text: 'palette tokens extended, both themes verified in the logo lab. PR #134.',
  },
  { t: 38, player: 'c', assign: 'apply the same tokens to the desktop app.' },
];

export const LOOP_SECONDS = 40;
