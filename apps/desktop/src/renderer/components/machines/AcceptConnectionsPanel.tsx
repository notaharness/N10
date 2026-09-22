import { CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatCountdown } from '../../lib/machines/machine-model.js';
import {
  useRegeneratePairingUrl,
  useSetAccepting,
} from '../../lib/data/mutations-machines.js';
import { useAcceptingStatus } from '../../lib/data/queries.js';
import type { AcceptingStatus } from '../../../host/contract.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Switch } from '../ui/switch.js';
import { RowShell } from '../settings/RowShell.js';

/** Toast copy for turning accepting off: it does not drop existing
 *  connections, so the count is worth saying either way. */
function offToast(connectedCount: number): string {
  if (connectedCount === 0) return 'Accepting off';
  const noun = connectedCount === 1 ? 'machine' : 'machines';
  return `Accepting off — ${connectedCount} ${noun} still connected`;
}

/**
 * "This desktop is dialled" — the switch, the bound address, and once
 * on: the pairing URL as selectable text with a copy button, a live
 * countdown to the token's expiry, and what pairing grants. Pairing is
 * a desktop-to-desktop handshake over that URL, so the URL itself is
 * the whole affordance.
 *
 * The switch and everything under it read this machine's own accepting
 * state — the copy beside the switch is a claim about who can reach
 * this machine, so it is never a fallback. The clock the countdown
 * reads ticks for as long as that state says the machine is accepting.
 */
export function AcceptConnectionsPanel() {
  const status = useAcceptingStatus();
  const setAccepting = useSetAccepting();
  const [now, setNow] = useState(() => Date.now());
  const accepting = status.data?.accepting ?? false;

  useEffect(() => {
    if (!accepting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [accepting]);

  const toggle = (checked: boolean) => {
    setAccepting.mutate(checked, {
      onSuccess: (result) => {
        toast.success(
          checked ? 'Accepting connections' : offToast(result.connectedCount)
        );
      },
      onError: (err: unknown) => toast.error(errorMessage(err)),
    });
  };

  return (
    <div className="px-4 py-3">
      <RowShell
        htmlFor="accept-connections"
        label="Accept connections"
        description={
          status.data?.boundAddress
            ? `Bound to ${status.data.boundAddress}`
            : 'Off — this machine cannot be dialled from elsewhere'
        }
        control={
          <Switch
            id="accept-connections"
            checked={accepting}
            disabled={setAccepting.isPending}
            onCheckedChange={toggle}
          />
        }
      />
      {accepting && status.data && (
        <ExpandedPanel status={status.data} now={now} />
      )}
    </div>
  );
}

/** The pairing URL and its countdown — or, once expired, the "generate
 *  a new URL" affordance instead of a silently dead URL. */
function ExpandedPanel({
  status,
  now,
}: {
  status: AcceptingStatus;
  now: number;
}) {
  const regenerate = useRegeneratePairingUrl();
  const expiresAt = status.pairingExpiresAt;
  const expired = expiresAt != null && expiresAt - now <= 0;

  const copyUrl = () => {
    if (!status.pairingUrl) return;
    void navigator.clipboard.writeText(status.pairingUrl);
    toast.success('Pairing URL copied');
  };

  return (
    <div className="mt-3 min-w-0 space-y-2 rounded-md border border-border bg-card p-3">
      {expired ? (
        <>
          <p className="text-sm text-muted-foreground">
            This pairing URL has expired.
          </p>
          <Button size="sm" onClick={() => regenerate.mutate()}>
            Generate a new URL
          </Button>
        </>
      ) : (
        <>
          <p className="select-all break-all font-mono text-xs text-foreground">
            {status.pairingUrl}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={copyUrl}>
              <CopyIcon className="size-3.5" />
              Copy
            </Button>
            <span className="text-sm text-muted-foreground">
              expires in {formatCountdown((expiresAt ?? now) - now)}
            </span>
          </div>
        </>
      )}
      <p className="text-sm text-muted-foreground">
        Pairing grants a shell on this machine as this user, revocable at any
        time.
      </p>
    </div>
  );
}
