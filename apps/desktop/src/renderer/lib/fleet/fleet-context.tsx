import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MachineView, MenuCommand } from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import { useCeremony, type Ceremony } from './use-ceremony.js';
import { useEnrolment, type Enrolment } from './use-enrolment.js';
import { useFleetReset } from './use-fleet-reset.js';

interface FleetContextValue {
  open: boolean;
  show: () => void;
  close: () => void;
  /** The first run: its choice, form values and ceremony. Owned here,
   *  above the repository gate, so leaving Fleet or switching
   *  repositories keeps them. */
  enrolment: Enrolment;
  /** The revocation dialog's machine and ceremony, kept the same way:
   *  leaving Fleet must not cancel a revocation waiting on a passkey. */
  revocation: {
    target: MachineView | null;
    ceremony: Ceremony;
    open: (machine: MachineView) => void;
    close: () => void;
  };
  reset: ReturnType<typeof useFleetReset>;
}

const FleetContext = createContext<FleetContextValue | null>(null);

/** Menu commands that act on the workspace under Fleet, so Fleet
 *  steps aside for them rather than hide their result. */
const LEAVES_FLEET: Record<MenuCommand, boolean> = {
  'open-repo': true,
  'switch-repo': true,
  'new-worktree': true,
  'new-terminal': true,
  'open-settings': true,
  'close-tab': true,
  'command-palette': true,
  'toggle-sidebar': false,
  'refresh-remote': false,
  'set-theme': false,
  'open-url': false,
  'show-shortcuts': false,
  about: false,
};

/** The machines list and beam's status are pushed whole on every
 *  change; they go straight into the cache, whatever screen is up. */
function useFleetPushes(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const offMachines = window.n10.onMachinesChanged((machines) => {
      qc.setQueryData(keys.machines, machines);
    });
    const offStatus = window.n10.onBeamStatusChanged((status) => {
      qc.setQueryData(keys.beamStatus, status);
    });
    return () => {
      offMachines();
      offStatus();
    };
  }, [qc]);
}

/**
 * Fleet is a destination of its own, not a repository's setting
 * (beam-fleet-ux.md §1). This sits above the repository gate and owns
 * whether Fleet is showing, the fleet data subscriptions and the one
 * enrolment controller.
 */
export function FleetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const enrolment = useEnrolment();
  const [revokeTarget, setRevokeTarget] = useState<MachineView | null>(null);
  const revokeCeremony = useCeremony();
  const reset = useFleetReset(enrolment.leave);
  useFleetPushes();

  // Focus goes back to whatever opened Fleet, once it is no longer inert.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) opener.current?.focus();
  }, [open]);
  const show = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      opener.current = document.activeElement;
    }
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(
    () =>
      window.n10.onMenuCommand(({ command }) => {
        if (LEAVES_FLEET[command]) setOpen(false);
      }),
    []
  );

  const closeRevocation = useCallback(() => setRevokeTarget(null), []);
  const value = useMemo(
    () => ({
      open,
      show,
      close,
      enrolment,
      revocation: {
        target: revokeTarget,
        ceremony: revokeCeremony,
        open: setRevokeTarget,
        close: closeRevocation,
      },
      reset,
    }),
    [
      open,
      show,
      close,
      enrolment,
      revokeTarget,
      revokeCeremony,
      closeRevocation,
      reset,
    ]
  );
  return (
    <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
  );
}

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside FleetProvider');
  return ctx;
}
