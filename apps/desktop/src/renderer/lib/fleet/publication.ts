import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CeremonyOutcome,
  DirectoryPublished,
} from '../../../host/contract-machines.js';

type Succeeded = Extract<CeremonyOutcome, { ok: true }>;

/** Whether an enrolment's or revocation's directory write landed
 *  (beam docs/06: `published: true | "pending"`). Pending is not a
 *  failure: beam retries while it runs. */
export function publicationText(published: boolean): string {
  return published
    ? 'Published to directory'
    : 'Saved on this machine. Directory publication is pending; beam will retry while it runs.';
}

/** A `directory.published` event's write. */
export function landedKey({ kind, peerId }: DirectoryPublished): string {
  return `${kind}/${peerId}`;
}

/** The write a ceremony queued, as its `directory.published` names it:
 *  this machine's membership, or the revoked machine's removal. */
export function publicationKey(outcome: Succeeded): string {
  return landedKey({
    kind: outcome.op === 'revoke' ? 'revoke' : 'member',
    peerId: outcome.peerId,
  });
}

/** The writes observed pending after a ceremony: a success that left
 *  its write pending adds it; anything else wrote nothing new. */
export function pendingAfter(
  pending: ReadonlySet<string>,
  outcome: CeremonyOutcome
): ReadonlySet<string> {
  if (!outcome.ok || outcome.published) return pending;
  return new Set(pending).add(publicationKey(outcome));
}

/**
 * Directory writes beam reported landed, and those ceremonies left
 * pending (beam-fleet-ux.md §1). Status cannot say a write is pending,
 * so only an observed pending result is shown, until its own event or
 * a reset.
 */
export function usePublication() {
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  useEffect(
    () =>
      window.n10.onDirectoryPublished((event) =>
        setLanded((s) => new Set(s).add(landedKey(event)))
      ),
    []
  );

  const settle = useCallback(
    (outcome: CeremonyOutcome) => setPending((p) => pendingAfter(p, outcome)),
    []
  );
  const clear = useCallback(() => {
    setPending(new Set());
    setLanded(new Set());
  }, []);
  const isPublished = useCallback(
    (outcome: Succeeded) =>
      outcome.published || landed.has(publicationKey(outcome)),
    [landed]
  );

  return useMemo(
    () => ({
      /** A write is still waiting for its event. */
      pending: [...pending].some((key) => !landed.has(key)),
      isPublished,
      settle,
      clear,
    }),
    [pending, landed, isPublished, settle, clear]
  );
}

export type Publication = ReturnType<typeof usePublication>;
