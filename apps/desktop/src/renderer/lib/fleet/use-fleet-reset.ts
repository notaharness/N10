import { useCallback, useMemo, useRef, useState } from 'react';
import type { FleetResetOutcome } from '../../../host/contract-machines.js';
import { errorMessage } from '../utils.js';

/**
 * Reset fleet on this machine (beam-fleet-ux.md §3): the dialog's
 * state, held above the repository gate so leaving Fleet mid-reset
 * loses neither the request nor its outcome. `onReset` runs whenever
 * the reset may have happened, to clear results it made stale.
 */
export function useFleetReset(onReset: () => void) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FleetResetOutcome | null>(null);
  const busyRef = useRef(false);

  const show = useCallback(() => {
    setTyped('');
    setOutcome(null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const run = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setOutcome(null);
    window.n10
      .resetFleet()
      .then(
        (result) => {
          if (result.ok || result.code === 'connection-lost') onReset();
          setOutcome(result);
        },
        (err: unknown) =>
          setOutcome({ ok: false, code: 'internal', detail: errorMessage(err) })
      )
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [onReset]);

  return useMemo(
    () => ({ open, typed, busy, outcome, show, close, setTyped, run }),
    [open, typed, busy, outcome, show, close, run]
  );
}
