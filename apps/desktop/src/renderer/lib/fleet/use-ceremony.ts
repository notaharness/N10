import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CeremonyOutcome,
  CeremonyRequest,
} from '../../../host/contract-machines.js';
import { errorMessage } from '../utils.js';
import {
  ceremonyStep,
  startView,
  type CeremonyView,
} from './ceremony-progress.js';

/**
 * Runs one passkey ceremony through the host and folds its pushed
 * progress into a `CeremonyView`. A second start while one runs is
 * ignored, so a double click starts one ceremony. Unmounting mid-
 * ceremony cancels it: beam runs one at a time, and an abandoned one
 * would hold the daemon `busy` until its five-minute timeout.
 */
export function useCeremony() {
  const [view, setView] = useState<CeremonyView | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<CeremonyOutcome | null>(null);
  const runningRef = useRef(false);

  const start = useCallback((request: CeremonyRequest) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setView(startView(request.op));
    setOutcome(null);
    setRunning(true);
    const off = window.n10.onCeremonyProgress((progress) =>
      setView((v) => v && ceremonyStep(v, progress))
    );
    window.n10
      .runCeremony(request)
      .then(setOutcome, (err: unknown) =>
        setOutcome({ ok: false, code: 'internal', detail: errorMessage(err) })
      )
      .finally(() => {
        off();
        runningRef.current = false;
        setRunning(false);
      });
  }, []);

  /** Forgets a finished ceremony, for the next one to start clean. */
  const reset = useCallback(() => {
    setView(null);
    setOutcome(null);
  }, []);

  /** Asks beam to cancel; the ceremony ends with its outcome. */
  const cancel = useCallback(() => {
    setView((v) => v && { ...v, cancelling: true });
    window.n10.cancelCeremony().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      if (runningRef.current)
        window.n10.cancelCeremony().catch(() => undefined);
    },
    []
  );

  return useMemo(
    () => ({ view, running, outcome, start, cancel, reset }),
    [view, running, outcome, start, cancel, reset]
  );
}

export type Ceremony = ReturnType<typeof useCeremony>;
