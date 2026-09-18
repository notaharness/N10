import { AlertTriangleIcon } from 'lucide-react';

/**
 * The terminal pane's connection banner (ux-machines.md §6). A dropped
 * network connection must never look like the agent exited — that
 * affordance is gated on `processState` elsewhere (TerminalView), never
 * on this — so this renders only for `reconnecting`/`failed` and shows
 * the terminal content underneath unobstructed.
 */
export function ConnectionBanner({
  state,
  machineLabel,
}: {
  state: 'reconnecting' | 'failed';
  /** The paired machine's label, resolved by the caller — never a
   *  peerId, which means nothing to the user. */
  machineLabel: string;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-sm text-warning"
    >
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span>
        {state === 'reconnecting'
          ? `Reconnecting to ${machineLabel}…`
          : `Disconnected from ${machineLabel}`}
      </span>
    </div>
  );
}
