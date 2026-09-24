import { CopyIcon, ExternalLinkIcon, LoaderIcon } from 'lucide-react';
import { toast } from 'sonner';
import type {
  CeremonyOutcome,
  CeremonyRequest,
} from '../../../host/contract-machines.js';
import type { CeremonyView } from '../../lib/machines/ceremony-model.js';
import {
  ceremonyExplanation,
  ceremonyHeading,
  ceremonyTarget,
} from '../../lib/machines/ceremony-copy.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';
import { QrCode } from './QrCode.js';

function PasskeyPrompt({ url }: { url: string }) {
  const target = ceremonyTarget(url);
  return (
    <div className="space-y-3">
      {target && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted p-3 text-sm">
          <dt>Action</dt>
          <dd>{target.action}</dd>
          <dt>Machine</dt>
          <dd className="break-words font-medium">{target.label}</dd>
          <dt>Machine fingerprint</dt>
          <dd className="select-all font-mono">
            {fingerprintGroups(target.fingerprint)}
          </dd>
        </dl>
      )}
      <div className="flex flex-wrap gap-4">
        <QrCode value={url} />
        <div className="min-w-0 flex-1 basis-52 space-y-2 text-sm">
          <p>
            Compare the action, machine name and machine fingerprint with the
            browser page. Continue only if you started this request.
          </p>
          <p
            className="break-all font-mono text-xs text-muted-foreground select-all"
            data-testid="ceremony-url"
          >
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                window.n10
                  .openExternal(url)
                  .catch(() => toast.error('Could not open the browser'))
              }
            >
              <ExternalLinkIcon /> Open in browser
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigator.clipboard.writeText(url).then(
                  () => toast.success('Link copied'),
                  () => toast.error('Could not copy the link')
                )
              }
            >
              <CopyIcon /> Copy link
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each passkey request expires after five minutes. Do not share this
            link or QR code. Anyone who sees it can answer this request first.
          </p>
        </div>
      </div>
    </div>
  );
}

export function CeremonyPanel({
  view,
  running,
  outcome,
  outcomeText,
  onCancel,
  operation = 'join',
}: {
  view: CeremonyView;
  running: boolean;
  outcome: CeremonyOutcome | null;
  outcomeText: string | null;
  onCancel: () => void;
  operation?: CeremonyRequest['op'];
}) {
  return (
    <div
      className="space-y-3 rounded-md border border-border p-3"
      aria-live="polite"
    >
      {running && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <LoaderIcon className="size-4 animate-spin" />
            {ceremonyHeading(view, operation)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {ceremonyExplanation(view, operation)}
          </p>
        </div>
      )}
      {running && view.passkeyUrl && <PasskeyPrompt url={view.passkeyUrl} />}
      {outcome && <CeremonyResult outcome={outcome} text={outcomeText} />}
      {running && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel setup
        </Button>
      )}
    </div>
  );
}

function CeremonyResult({
  outcome,
  text,
}: {
  outcome: CeremonyOutcome;
  text: string | null;
}) {
  return (
    <div
      role={outcome.ok ? 'status' : 'alert'}
      className={`space-y-2 text-sm ${
        outcome.ok ? 'text-success' : 'text-destructive'
      }`}
    >
      <p>{text}</p>
      {!outcome.ok && (
        <p className="select-all font-mono text-xs">{outcome.code}</p>
      )}
      {!outcome.ok && outcome.detail && (
        <details>
          <summary>Technical details</summary>
          <p className="break-words select-all font-mono text-xs">
            {outcome.detail}
          </p>
        </details>
      )}
    </div>
  );
}
