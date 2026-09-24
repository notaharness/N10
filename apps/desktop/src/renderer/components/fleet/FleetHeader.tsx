import { Button } from '../ui/button.js';

/** Fleet's actions on this machine's enrolment. */
export function FleetHeader({
  disabled,
  onReset,
}: {
  disabled: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" variant="outline" disabled={disabled} onClick={onReset}>
        Reset fleet on this machine…
      </Button>
    </div>
  );
}
