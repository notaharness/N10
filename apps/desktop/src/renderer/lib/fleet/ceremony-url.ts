import { fingerprintGroups } from '../machines/machine-model.js';
import { nameError } from './names.js';

/** The **Action** value beam.n10.is shows for each `o=`, word for
 *  word (beam-fleet-ux.md §5, "Literal Action values"): the owner
 *  compares the two. */
const ACTIONS: Record<string, (f: URLSearchParams) => string> = {
  c: (f) => `Create fleet passkey for “${f.get('n') || 'beam'}”`,
  a: (f) => `Add “${f.get('l')}” to fleet`,
  r: (f) => `Remove “${f.get('l')}” from fleet`,
};

interface CeremonySummary {
  action: string;
  machine: string;
  /** The machine fingerprint, grouped as beam prints it. */
  fingerprint: string;
}

/**
 * What a passkey request is for, read from its URL's fragment as the
 * page reads it (beam docs/02: `o`, `l`, `f`, `n`), so the owner can
 * compare the two. Null when the fragment is not one beam would write.
 */
export function ceremonySummary(ceremonyUrl: string): CeremonySummary | null {
  let fragment: URLSearchParams;
  try {
    fragment = new URLSearchParams(new URL(ceremonyUrl).hash.slice(1));
  } catch {
    return null;
  }
  const o = fragment.get('o') ?? '';
  const action = Object.hasOwn(ACTIONS, o) ? ACTIONS[o] : undefined;
  const machine = fragment.get('l') ?? '';
  const fingerprint = fragment.get('f') ?? '';
  if (
    !action ||
    !machine ||
    nameError(machine) ||
    nameError(fragment.get('n') ?? '') ||
    !/^[0-9a-f]{16}$/.test(fingerprint)
  ) {
    return null;
  }
  return {
    action: action(fragment),
    machine,
    fingerprint: fingerprintGroups(fingerprint),
  };
}
