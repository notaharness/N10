import { toast } from 'sonner';
import type { InboundMailRow } from '../../lib/machines/machine-model.js';
import { useDismissInboundMail } from '../../lib/data/mutations-machines.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/**
 * A machine row's inbound-mail rows — waiting and refused, oldest
 * first (ux-machines.md §7: visible and durable, never a toast that
 * disappears before the user returns). Split out of `MachineRow.tsx`
 * to keep that component's own complexity within budget. Renders
 * nothing when both lists are empty.
 */
export function InboundMailPanel({
  waiting,
  refused,
}: {
  waiting: InboundMailRow[];
  refused: InboundMailRow[];
}) {
  const dismissMail = useDismissInboundMail();
  if (waiting.length === 0 && refused.length === 0) return null;

  return (
    <div className="space-y-1 bg-muted/30 px-4 pb-3 pl-[calc(0.75rem+0.5rem+1rem)] text-xs">
      {waiting.map((row) => (
        <div
          key={row.id}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <span className="truncate">
            Waiting to deliver to{' '}
            <span className="font-mono">{row.target}</span> — received {row.age}
          </span>
        </div>
      ))}
      {refused.map((row) => (
        <div key={row.id} className="flex items-center gap-2 text-destructive">
          <span className="min-w-0 flex-1 truncate">
            Refused for <span className="font-mono">{row.target}</span>:{' '}
            {row.reason} — received {row.age}
          </span>
          <Tip label="Deletes this report from the sender's mailbox for good">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 shrink-0 px-1.5 text-xs"
              onClick={() =>
                dismissMail.mutate(row.id, {
                  onError: (err: unknown) => toast.error(errorMessage(err)),
                })
              }
            >
              Dismiss
            </Button>
          </Tip>
        </div>
      ))}
    </div>
  );
}
