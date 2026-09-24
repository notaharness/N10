import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CeremonyOutcome } from '../../../host/contract-machines.js';
import type { CeremonyView } from '../../lib/machines/ceremony-model.js';
import { Button } from '../ui/button.js';
import { QrCode } from './QrCode.js';

function copyLink(url: string): void {
  navigator.clipboard.writeText(url).then(
    () => toast.success('Link copied'),
    () => toast.error('Could not copy the link')
  );
}

function openLink(url: string): void {
  window.n10
    .openExternal(url)
    .catch(() => toast.error('Could not open the browser'));
}

function PasskeyPrompt({ url }: { url: string }) {
  return (
    <div className="flex gap-4">
      <QrCode value={url} />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p>
          Scan with your phone, or open the link in a browser. Continue only on
          a page that shows this machine.
        </p>
        <p
          className="truncate font-mono text-xs text-muted-foreground select-all"
          title={url}
          data-testid="ceremony-url"
        >
          {url}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openLink(url)}>
            <ExternalLinkIcon className="size-3.5" />
            Open in browser
          </Button>
          <Button size="sm" variant="outline" onClick={() => copyLink(url)}>
            <CopyIcon className="size-3.5" />
            Copy link
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A passkey ceremony in progress or finished: beam's stages as they are
 * reached, the passkey link as a QR code, text and a browser button
 * while the daemon waits on it, then the outcome line.
 */
export function CeremonyPanel({
  view,
  running,
  outcome,
  outcomeText,
  onCancel,
}: {
  view: CeremonyView;
  running: boolean;
  outcome: CeremonyOutcome | null;
  outcomeText: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3" aria-live="polite">
      <ol className="space-y-1 text-sm">
        {view.stages.map((stage, i) => {
          const current = running && i === view.stages.length - 1;
          return (
            <li
              key={stage}
              className={`flex items-center gap-2 ${
                current ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {current ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              {stage}
            </li>
          );
        })}
      </ol>
      {running && view.passkeyUrl && <PasskeyPrompt url={view.passkeyUrl} />}
      {outcome && outcomeText && (
        <p
          role="status"
          className={`text-sm ${
            outcome.ok ? 'text-success' : 'text-destructive'
          }`}
        >
          {outcomeText}
        </p>
      )}
      {running && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}
