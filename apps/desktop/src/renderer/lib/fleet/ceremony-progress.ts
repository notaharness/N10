import type {
  CeremonyProgress,
  CeremonyRequest,
} from '../../../host/contract-machines.js';

export type CeremonyOp = CeremonyRequest['op'];

/** Where a running ceremony is, from the host's progress events. */
type CeremonyPhase =
  | 'preparing'
  | 'passkey'
  | 'reading-directory'
  | 'notifying-peers'
  | 'publishing';

export interface CeremonyView {
  op: CeremonyOp;
  phase: CeremonyPhase;
  /** The passkey step reached: 0 before the first link, then 1, and
   *  2 for `init`'s second prompt. */
  step: number;
  /** The live link, only while beam waits on that passkey step. */
  passkeyUrl: string | null;
  cancelling: boolean;
}

export function startView(op: CeremonyOp): CeremonyView {
  return {
    op,
    phase: 'preparing',
    step: 0,
    passkeyUrl: null,
    cancelling: false,
  };
}

/** beam's `stage` names (docs/06, docs/07) and the host's own. */
const STAGES: Record<string, CeremonyPhase> = {
  'preparing network': 'preparing',
  'reading directory': 'reading-directory',
  'notifying peers': 'notifying-peers',
  publishing: 'publishing',
};

/**
 * One progress event folded in. A new passkey link replaces the old
 * one outright, and any stage after it drops the link: a finished
 * step's link is never left showing.
 */
export function ceremonyStep(
  view: CeremonyView,
  progress: CeremonyProgress
): CeremonyView {
  if (progress.kind === 'passkey') {
    const second = view.op === 'init' && progress.step === 'sign';
    return {
      ...view,
      phase: 'passkey',
      step: second ? 2 : 1,
      passkeyUrl: progress.ceremonyUrl,
    };
  }
  if (!Object.hasOwn(STAGES, progress.stage)) return view;
  return { ...view, phase: STAGES[progress.stage], passkeyUrl: null };
}

/** The two passkey prompts a fleet's creation needs, always listed. */
export const INIT_STEPS = [
  'Create your fleet passkey',
  'Authorize this machine',
] as const;

/** The passkey steps are answered: beam is doing its own work. */
export function pastPasskeys(view: CeremonyView): boolean {
  return view.phase !== 'preparing' && view.phase !== 'passkey';
}

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';

/** Each of `init`'s steps, given how far the view got and whether it
 *  failed. The step a failure or cancellation stopped on is `failed`,
 *  never `done`. */
export function initStepStatuses(
  view: CeremonyView,
  failed: boolean
): StepStatus[] {
  const past = pastPasskeys(view);
  return INIT_STEPS.map((_, i) => {
    const n = i + 1;
    if (past || n < view.step) return 'done';
    if (n > view.step) return 'pending';
    return failed ? 'failed' : 'active';
  });
}

interface CeremonyHeading {
  heading: string;
  explanation: string | null;
}

const PREPARING: CeremonyHeading = {
  heading: 'Preparing network…',
  explanation:
    'beam is preparing this machine before opening the passkey steps.',
};

const PUBLISHING: Record<CeremonyOp, CeremonyHeading> = {
  init: {
    heading: 'Publishing membership…',
    explanation:
      'The passkey steps are complete. beam is saving this machine’s membership.',
  },
  join: { heading: 'Publishing membership…', explanation: null },
  revoke: { heading: 'Publishing revocation…', explanation: null },
};

const PASSKEY: Record<CeremonyOp, CeremonyHeading[]> = {
  init: [
    {
      heading: 'Step 1 of 2 · Create your fleet passkey',
      explanation:
        'Save a new passkey for beam.n10.is. Then return here for the second prompt.',
    },
    {
      heading: 'Step 2 of 2 · Authorize this machine',
      explanation:
        'Use the passkey you just created. This signs this machine’s membership and derives the key for the encrypted directory.',
    },
  ],
  join: [
    {
      heading: 'Authorize this machine',
      explanation:
        'Choose this fleet’s existing passkey. Do not create another passkey.',
    },
  ],
  revoke: [{ heading: 'Authorize revocation', explanation: null }],
};

/** What a running ceremony says at the top, from its latest signal. */
export function ceremonyHeading(view: CeremonyView): CeremonyHeading {
  if (view.cancelling) return { heading: 'Cancelling…', explanation: null };
  switch (view.phase) {
    case 'preparing':
      return PREPARING;
    case 'passkey':
      return PASSKEY[view.op][view.step - 1];
    case 'reading-directory':
      return { heading: 'Reading fleet directory…', explanation: null };
    case 'notifying-peers':
      return { heading: 'Notifying peers…', explanation: null };
    case 'publishing':
      return PUBLISHING[view.op];
  }
}
