/**
 * Turning whatever `beam-node.ts`'s pairing calls threw into a specific,
 * actionable `PairFailure` — split out of `beam-node.ts` because it is
 * one self-contained subject (string sniffing on library error
 * messages) and that file is a catalogue already. Errors are specific
 * and actionable (the UX spec's copy rule): never "something went
 * wrong".
 */
import { PeerKeyMismatchError } from '@n10/beam';
import type { PairFailure } from '../host/contract-machines.js';

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      }
    );
  });
}

export function classifyPairError(error: unknown): PairFailure {
  if (error instanceof PeerKeyMismatchError) {
    return {
      reason: 'key-mismatch',
      message: error.message,
      peerId: error.peerId,
      existingLabel: error.existingLabel,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/carries no #token=/.test(message) || /invalid url/i.test(message)) {
    return {
      reason: 'invalid-url',
      message:
        'That does not look like a pairing URL — check it was copied in full.',
    };
  }
  // host-routes.ts answers the same 401 for an expired token and an
  // already-spent one; the two are genuinely indistinguishable from here.
  if (/pairing failed \(401\)/.test(message)) {
    return {
      reason: 'invalid-token',
      message:
        'This pairing link has expired or was already used — ask for a fresh one.',
    };
  }
  if (/speaks protocol/.test(message)) {
    return { reason: 'protocol-mismatch', message };
  }
  return {
    reason: 'unreachable',
    message: `Could not reach that machine: ${message}`,
  };
}
