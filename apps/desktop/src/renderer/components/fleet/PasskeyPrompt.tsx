import { CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { copyText } from '../../lib/copy-text.js';
import { ceremonySummary } from '../../lib/fleet/ceremony-url.js';
import { openLink } from '../../lib/open-link.js';
import { QrCode } from '../machines/QrCode.js';
import { Button } from '../ui/button.js';

/**
 * One passkey step's link: its QR code, what it asks for as the page
 * will show it, and the link itself (beam-fleet-ux.md §2, §6).
 */
export function PasskeyPrompt({ url }: { url: string }) {
  const summary = ceremonySummary(url);
  return (
    <div className="flex flex-wrap justify-center gap-4">
      <QrCode value={url} />
      <div className="min-w-0 flex-1 basis-64 space-y-3 text-sm">
        {summary && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Action</dt>
            <dd className="break-words">{summary.action}</dd>
            <dt className="text-muted-foreground">Machine</dt>
            <dd className="break-words">{summary.machine}</dd>
            <dt className="text-muted-foreground">Machine fingerprint</dt>
            <dd className="font-mono select-all">{summary.fingerprint}</dd>
          </dl>
        )}
        <p>
          Compare the action, machine name and machine fingerprint with the
          browser page. Continue only if you started this request.
        </p>
        <p
          className="truncate font-mono text-xs text-muted-foreground select-all"
          title={url}
          data-testid="ceremony-url"
        >
          {url}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openLink(url)}>
            <ExternalLinkIcon className="size-3.5" />
            Open in browser
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyText(url, 'Link copied')}
          >
            <CopyIcon className="size-3.5" />
            Copy link
          </Button>
        </div>
        <p className="text-muted-foreground">
          Each passkey request expires after five minutes. Do not share this
          link or QR code. Anyone who sees it can answer this request first.
        </p>
      </div>
    </div>
  );
}
