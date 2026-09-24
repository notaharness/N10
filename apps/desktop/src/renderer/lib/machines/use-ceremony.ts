import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CeremonyOutcome,
  CeremonyRequest,
} from '../../../host/contract-machines.js';
import { errorMessage } from '../utils.js';
import {
  EMPTY_CEREMONY,
  ceremonyStep,
  type CeremonyView,
} from './ceremony-model.js';

/**
 * Runs one passkey ceremony through the host and folds its pushed
 * progress into a `CeremonyView`. Leaving the surface mid-ceremony
 * cancels it: beam runs one at a time, and an abandoned one would hold
 * the daemon `busy` until its five-minute timeout.
 */
export function useCeremony() {
  const [view, setView] = useState<CeremonyView>(EMPTY_CEREMONY);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<CeremonyOutcome | null>(null);
  const runningRef = useRef(false);

  const start = useCallback((request: CeremonyRequest) => {
    if (runningRef.current) return;
    setView(EMPTY_CEREMONY);
    setOutcome(null);
    setRunning(true);
    runningRef.current = true;
    const off = window.n10.onCeremonyProgress((progress) =>
      setView((v) => ceremonyStep(v, progress))
    );
    window.n10
      .runCeremony(request)
      .then(setOutcome, (err: unknown) =>
        setOutcome({ ok: false, code: 'internal', message: errorMessage(err) })
      )
      .finally(() => {
        off();
        runningRef.current = false;
        setRunning(false);
      });
  }, []);

  const cancel = useCallback(() => {
    window.n10.cancelCeremony().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      if (runningRef.current) cancel();
    },
    [cancel]
  );

  const clear = useCallback(() => {
    if (runningRef.current) return;
    setView(EMPTY_CEREMONY);
    setOutcome(null);
  }, []);

  return { view, running, outcome, start, cancel, clear };
}
