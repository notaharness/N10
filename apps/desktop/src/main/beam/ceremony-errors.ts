import type { CeremonyOutcome } from '../../host/contract-machines.js';
import { BeamOpError } from './control.js';

const FAILURES: Record<string, string> = {
  'prf-unsupported':
    'The selected passkey did not provide WebAuthn PRF. beam needs this extension to derive the encrypted fleet directory key. Browser, operating system and passkey provider must all support it.',
  'directory-unavailable':
    'Cannot read the fleet directory. Check the connection to beam.n10.is and try joining again.',
  'wrong-passkey':
    'This passkey does not unlock the expected fleet. Choose the original fleet passkey using a compatible browser and provider.',
  'ceremony-timeout':
    'This passkey request expired after five minutes. Start again to get a new link and QR code.',
  'ceremony-cancelled':
    'Passkey request cancelled. No further approval is pending for this request.',
  'ceremony-state':
    'beam could not use this ceremony result. The request may be stale, already consumed, or answered with data it cannot decrypt. Check this machine’s fleet status, then start again with a fresh link.',
  busy: 'Another passkey request is already running. Finish or cancel it where you started it, then try again.',
  'already-enrolled':
    'This machine already belongs to a fleet. Open Fleet to inspect it.',
  'not-enrolled':
    'This machine is not in a fleet. Create or join a fleet first.',
  'bad-assertion':
    'The passkey request failed or its answer could not be verified. Check the browser’s message, then start again.',
  'revoked-peer':
    'This machine identity has been revoked. Resetting its fleet will not make that identity eligible to rejoin.',
  'unknown-peer':
    'This machine is no longer in the local peer list. Refresh Fleet before trying again.',
  'ambiguous-peer':
    'More than one machine matches. Select a machine by its fingerprint.',
  params: 'beam rejected these details. Check the machine and fleet names.',
  'bad-entry':
    'beam rejected an invalid membership record. Check the details before trying again.',
  'storage-failure':
    'beam could not save fleet data. Check available disk space and permissions, then retry.',
  offline: 'The machine is offline. Try again after it reconnects.',
  grant: 'This machine does not allow that operation.',
  limit: 'beam reached a capacity limit. Check the details before retrying.',
  'queue-full':
    'beam reached a capacity limit. Check the details before retrying.',
  spawn: 'beam could not start the requested process. Check the details.',
};

export function ceremonyFailure(err: unknown): CeremonyOutcome {
  if (err instanceof BeamOpError) {
    return {
      ok: false,
      code: err.code,
      message:
        FAILURES[err.code] ??
        'beam could not complete this request. Check the details and this machine’s fleet status before retrying.',
      ...(err.detail ? { detail: err.detail } : {}),
    };
  }
  return {
    ok: false,
    code: 'connection-lost',
    message:
      'The connection to beam was interrupted. Check Fleet before retrying; the request may have completed.',
    detail: err instanceof Error ? err.message : String(err),
  };
}
