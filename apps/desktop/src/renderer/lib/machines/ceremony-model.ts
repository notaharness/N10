import type {
  CeremonyOutcome,
  CeremonyProgress,
} from '../../../host/contract-machines.js';
import { fingerprintGroups } from './machine-model.js';

/**
 * What a running passkey ceremony shows: the stages reached so far, in
 * beam's own words (beam docs/07), and — while the daemon waits for a
 * passkey — the URL to open or scan. A pure fold over the host's
 * progress events, so the panel renders whatever order they arrive in.
 */
export interface CeremonyView {
  stages: string[];
  /** Set while the daemon waits on the owner's passkey. */
  passkeyUrl: string | null;
}

export const EMPTY_CEREMONY: CeremonyView = { stages: [], passkeyUrl: null };

export function ceremonyStep(
  view: CeremonyView,
  progress: CeremonyProgress
): CeremonyView {
  if (progress.kind === 'passkey') {
    return {
      stages: [...view.stages, `waiting for your passkey (${progress.step})`],
      passkeyUrl: progress.ceremonyUrl,
    };
  }
  return { stages: [...view.stages, progress.stage], passkeyUrl: null };
}

function publication(published: boolean): string {
  return published
    ? 'published to directory'
    : 'publication pending; will retry';
}

/**
 * The line a finished ceremony ends on, as beam's CLI words it
 * (beam docs/07). `thisMachine` names this machine for `init`; `others`
 * is how many other members a revocation could reach.
 */
export function ceremonyOutcomeText(
  outcome: CeremonyOutcome,
  context: { thisMachine?: string; others?: number } = {}
): string {
  if (!outcome.ok) return outcome.message;
  switch (outcome.op) {
    case 'init':
      return `Created fleet ${fingerprintGroups(
        outcome.fleetId
      )} · this machine${
        context.thisMachine ? `: ${context.thisMachine}` : ''
      } (${fingerprintGroups(outcome.peerId)}) · ${publication(
        outcome.published
      )}`;
    case 'join':
      return `Joined fleet ${fingerprintGroups(outcome.fleetId)}; ${
        outcome.members
      } other machine${outcome.members === 1 ? '' : 's'} known; connecting…`;
    case 'revoke':
      return `Revoked here · ${
        outcome.published ? 'published' : 'publication pending'
      } · acknowledged by ${outcome.acknowledgedBy}${
        context.others === undefined ? '' : ` of ${context.others}`
      } peer${(context.others ?? outcome.acknowledgedBy) === 1 ? '' : 's'}`;
  }
}
