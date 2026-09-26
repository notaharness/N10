/**
 * beam-fleet-ux.md §4: what each failure code tells the owner, and the
 * next actions that can actually run from it. `retry` starts the same
 * flow afresh, `back` returns to its form with the values kept,
 * `close` leaves the result, `compatibility` opens the passkey help.
 */
export type NextAction = 'retry' | 'back' | 'close' | 'compatibility';

interface FailureCopy {
  explanation: string;
  actions: NextAction[];
}

const CAPACITY: FailureCopy = {
  explanation:
    'beam reached a capacity limit. Check the details before retrying.',
  actions: ['close'],
};

const INTERNAL: FailureCopy = {
  explanation:
    'beam could not complete this request. Check the details and this machine’s fleet status before retrying.',
  actions: ['close'],
};

const CATALOGUE: Record<string, FailureCopy> = {
  'prf-unsupported': {
    explanation:
      'The selected passkey did not provide WebAuthn PRF. beam needs this extension to derive the encrypted fleet directory key. Browser, operating system and passkey provider must all support it.',
    actions: ['compatibility', 'retry', 'back'],
  },
  'ceremony-cancelled': {
    explanation:
      'Passkey request cancelled. No further approval is pending for this request.',
    actions: ['retry', 'back'],
  },
  'ceremony-timeout': {
    explanation:
      'This passkey request expired after five minutes. Start again to get a new link and QR code.',
    actions: ['retry'],
  },
  'ceremony-state': {
    explanation:
      'beam could not use this ceremony result. The request may be stale, already consumed, or answered with data it cannot decrypt. Check this machine’s fleet status, then start again with a fresh link.',
    actions: ['close', 'retry'],
  },
  'bad-assertion': {
    explanation:
      'The passkey request failed or its answer could not be verified. Check the browser’s message, then start again.',
    actions: ['retry'],
  },
  'directory-unavailable': {
    explanation:
      'Cannot read the fleet directory. Check the connection to beam.n10.is and try joining again.',
    actions: ['retry'],
  },
  'wrong-passkey': {
    explanation:
      'This passkey does not unlock the expected fleet. Choose the original fleet passkey using a compatible browser and provider.',
    actions: ['retry'],
  },
  busy: {
    explanation:
      'Another passkey request is already running. Finish or cancel it where you started it, then try again.',
    actions: ['back'],
  },
  'already-enrolled': {
    explanation:
      'This machine already belongs to a fleet. Close this to see its machines.',
    actions: ['close'],
  },
  'not-enrolled': {
    explanation:
      'This machine is not in a fleet. Create or join a fleet first.',
    actions: ['close'],
  },
  'revoked-peer': {
    explanation:
      'This machine identity has been revoked. Resetting its fleet will not make that identity eligible to rejoin.',
    actions: ['close'],
  },
  'unknown-peer': {
    explanation:
      'This machine is no longer in the local peer list. Refresh Fleet before trying again.',
    actions: ['close'],
  },
  'ambiguous-peer': {
    explanation:
      'More than one machine matches. Select a machine by its fingerprint.',
    actions: ['close'],
  },
  params: {
    explanation:
      'beam rejected these details. Check the machine and fleet names.',
    actions: ['back'],
  },
  'bad-entry': {
    explanation:
      'beam rejected an invalid membership record. Check the details before trying again.',
    actions: ['back'],
  },
  'storage-failure': {
    explanation:
      'beam could not save fleet data. Check available disk space and permissions, then retry.',
    actions: ['retry'],
  },
  offline: {
    explanation: 'The machine is offline. Try again after it reconnects.',
    actions: ['close'],
  },
  grant: {
    explanation: 'This machine does not allow that operation.',
    actions: ['close'],
  },
  limit: CAPACITY,
  'queue-full': CAPACITY,
  spawn: {
    explanation:
      'beam could not start the requested process. Check the details.',
    actions: ['back'],
  },
  internal: INTERNAL,
  'connection-lost': {
    explanation:
      'The connection to beam was interrupted. Check Fleet before retrying; the request may have completed.',
    actions: ['close'],
  },
};

/** The copy for `code`; an unknown code reads as `internal`. */
export function failureCopy(code: string): FailureCopy {
  return Object.hasOwn(CATALOGUE, code) ? CATALOGUE[code] : INTERNAL;
}

/** A PRF failure while joining or revoking: the fix is a supported
 *  provider for the same passkey, not a new one. */
export const SAME_PASSKEY_NOTE =
  'Use the same fleet passkey; a new passkey creates a different fleet.';

/** Shown on top of any failure of a fleet's creation once its first
 *  passkey prompt was offered: a passkey may already exist. */
export const CREATE_FAILURE_NOTE =
  'If you saved a passkey before this stopped, it may still be in your passkey manager. It does not mean a fleet was created. Check this machine’s status before trying again.';
