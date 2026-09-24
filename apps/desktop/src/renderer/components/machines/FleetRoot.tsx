import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FleetContext } from '../../lib/machines/fleet-context.js';
import { keys } from '../../lib/data/query-keys.js';
import { FleetView } from './FleetView.js';

/** Fleet and its subscriptions survive repository switches and navigation. */
export function FleetRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const surface = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  useEffect(() => {
    if (open) surface.current?.querySelector('h1')?.focus();
    else opener.current?.focus();
  }, [open]);
  const context = useMemo(() => ({ open, show }), [open, show]);
  useEffect(() => {
    const offMachines = window.n10.onMachinesChanged((machines) =>
      qc.setQueryData(keys.machines, machines)
    );
    const offStatus = window.n10.onBeamStatusChanged((status) =>
      qc.setQueryData(keys.beamStatus, status)
    );
    return () => {
      offMachines();
      offStatus();
    };
  }, [qc]);
  return (
    <FleetContext value={context}>
      <div inert={open} aria-hidden={open || undefined}>
        {children}
      </div>
      <div
        ref={surface}
        className={
          open
            ? 'fixed inset-0 z-40 flex flex-col bg-background text-foreground'
            : 'hidden'
        }
      >
        <FleetView onBack={() => setOpen(false)} />
      </div>
    </FleetContext>
  );
}
