import { describe, expect, it } from 'vitest';
import type { CeremonyProgress } from '../../../host/contract-machines.js';
import {
  ceremonyHeading,
  ceremonyStep,
  initStepStatuses,
  startView,
  type CeremonyOp,
} from './ceremony-progress.js';

const STEP_1 = 'https://beam.n10.is/#o=c&l=laptop&f=a1b2c3d4e5f60718';
const STEP_2 = 'https://beam.n10.is/#o=a&l=laptop&f=a1b2c3d4e5f60718';

function walk(op: CeremonyOp, events: CeremonyProgress[]) {
  return events.reduce(ceremonyStep, startView(op));
}

const preparing: CeremonyProgress = {
  kind: 'stage',
  stage: 'preparing network',
};
const create: CeremonyProgress = {
  kind: 'passkey',
  step: 'create',
  ceremonyUrl: STEP_1,
};
const sign: CeremonyProgress = {
  kind: 'passkey',
  step: 'sign',
  ceremonyUrl: STEP_2,
};
const publishing: CeremonyProgress = { kind: 'stage', stage: 'publishing' };

describe('ceremonyStep', () => {
  it('walks init through both passkey steps, each with its own link', () => {
    const one = walk('init', [preparing, create]);
    expect(one).toMatchObject({
      phase: 'passkey',
      step: 1,
      passkeyUrl: STEP_1,
    });
    const two = ceremonyStep(one, sign);
    expect(two).toMatchObject({
      phase: 'passkey',
      step: 2,
      passkeyUrl: STEP_2,
    });
  });

  it('drops the link as soon as the daemon moves past the passkey', () => {
    expect(walk('init', [create, sign, publishing])).toMatchObject({
      phase: 'publishing',
      passkeyUrl: null,
    });
    expect(
      walk('join', [sign, { kind: 'stage', stage: 'reading directory' }])
    ).toMatchObject({ phase: 'reading-directory', passkeyUrl: null });
  });

  it('drops a revocation’s answered link once beam notifies peers', () => {
    const view = walk('revoke', [
      sign,
      { kind: 'stage', stage: 'notifying peers' },
    ]);
    expect(view).toMatchObject({ phase: 'notifying-peers', passkeyUrl: null });
    expect(ceremonyHeading(view).heading).toBe('Notifying peers…');
  });

  it('counts a join or revoke signature as its one step', () => {
    expect(walk('join', [sign]).step).toBe(1);
    expect(walk('revoke', [sign]).step).toBe(1);
  });

  it('ignores a stage it does not know', () => {
    const view = walk('init', [create]);
    expect(ceremonyStep(view, { kind: 'stage', stage: 'dancing' })).toBe(view);
    expect(ceremonyStep(view, { kind: 'stage', stage: 'toString' })).toBe(view);
  });
});

describe('initStepStatuses', () => {
  it('distinguishes pending, active and completed steps', () => {
    expect(initStepStatuses(walk('init', [preparing]), false)).toEqual([
      'pending',
      'pending',
    ]);
    expect(initStepStatuses(walk('init', [create]), false)).toEqual([
      'active',
      'pending',
    ]);
    expect(initStepStatuses(walk('init', [create, sign]), false)).toEqual([
      'done',
      'active',
    ]);
    expect(
      initStepStatuses(walk('init', [create, sign, publishing]), false)
    ).toEqual(['done', 'done']);
  });

  it('never marks the step a failure stopped on as done', () => {
    expect(initStepStatuses(walk('init', [create]), true)).toEqual([
      'failed',
      'pending',
    ]);
    expect(initStepStatuses(walk('init', [create, sign]), true)).toEqual([
      'done',
      'failed',
    ]);
    expect(initStepStatuses(walk('init', [preparing]), true)).toEqual([
      'pending',
      'pending',
    ]);
  });
});

describe('ceremonyHeading', () => {
  it('names each signal of a fleet’s creation', () => {
    const heading = (events: CeremonyProgress[]) =>
      ceremonyHeading(walk('init', events)).heading;
    expect(heading([preparing])).toBe('Preparing network…');
    expect(heading([create])).toBe('Step 1 of 2 · Create your fleet passkey');
    expect(heading([create, sign])).toBe(
      'Step 2 of 2 · Authorize this machine'
    );
    expect(heading([create, sign, publishing])).toBe('Publishing membership…');
  });

  it('tells a joining machine not to create another passkey', () => {
    expect(ceremonyHeading(walk('join', [sign]))).toEqual({
      heading: 'Authorize this machine',
      explanation:
        'Choose this fleet’s existing passkey. Do not create another passkey.',
    });
    expect(
      ceremonyHeading(
        walk('join', [sign, { kind: 'stage', stage: 'reading directory' }])
      ).heading
    ).toBe('Reading fleet directory…');
  });

  it('asks for the revocation’s authorization', () => {
    expect(ceremonyHeading(walk('revoke', [sign])).heading).toBe(
      'Authorize revocation'
    );
  });

  it('says it is cancelling until the outcome arrives', () => {
    const view = { ...walk('init', [create]), cancelling: true };
    expect(ceremonyHeading(view).heading).toBe('Cancelling…');
  });
});
