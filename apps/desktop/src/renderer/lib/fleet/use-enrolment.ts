import { useCallback, useMemo, useState } from 'react';
import type { CeremonyRequest } from '../../../host/contract-machines.js';
import { useCeremony } from './use-ceremony.js';

type EnrolmentMode = 'create' | 'join';

/**
 * The first-run flow (beam-fleet-ux.md §2): a choice between creating
 * and joining, that choice's form, then its ceremony. The form's values
 * outlive a failure, so **Back** and **Try again** start from them.
 */
export function useEnrolment() {
  const ceremony = useCeremony();
  const { start, reset } = ceremony;
  /** Null while the two choices show. */
  const [mode, setMode] = useState<EnrolmentMode | null>(null);
  const [label, setLabel] = useState('');
  const [fleetName, setFleetName] = useState('');

  const submit = useCallback(() => {
    const request: CeremonyRequest =
      mode === 'create'
        ? { op: 'init', label, fleetName }
        : { op: 'join', label };
    start(request);
  }, [mode, label, fleetName, start]);

  /** From a result back to the choices. */
  const leave = useCallback(() => {
    reset();
    setMode(null);
  }, [reset]);

  return useMemo(
    () => ({
      ceremony,
      mode,
      label,
      fleetName,
      choose: setMode,
      setLabel,
      setFleetName,
      submit,
      leave,
    }),
    [ceremony, mode, label, fleetName, submit, leave]
  );
}

export type Enrolment = ReturnType<typeof useEnrolment>;
