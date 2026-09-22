import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import type { PairPreviewResult } from '../../../host/contract-machines.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible.js';

interface View {
  keyMismatch: { existingLabel?: string } | null;
  failure: { message: string } | null;
  showPreview: boolean;
}

/** The dialog's middle section: an error banner, the fetched preview
 *  card, the key-mismatch warning, or the collapsed "what we advertise
 *  back" explainer — split out of `PairMachineDialog.tsx` to keep that
 *  component's own complexity down to its own decisions (which mutation
 *  to fire, when to reset). */
export function PairDialogBody({
  view,
  preview,
  localEndpoints,
}: {
  view: View;
  preview: PairPreviewResult | undefined;
  localEndpoints: string[];
}) {
  return (
    <>
      {view.failure && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {view.failure.message}
        </p>
      )}
      {view.showPreview && preview?.ok && (
        <PreviewCard preview={preview.preview} />
      )}
      {view.keyMismatch && (
        <KeyMismatchCard
          existingLabel={view.keyMismatch.existingLabel ?? 'that machine'}
        />
      )}
      <AdvertisedEndpoints endpoints={localEndpoints} />
    </>
  );
}

function PreviewCard({
  preview,
}: {
  preview: { label: string; peerId: string; endpoint: string };
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <Field label="Machine" value={preview.label} />
      <Field
        label="Fingerprint"
        value={fingerprintGroups(preview.peerId)}
        mono
        selectable
      />
      <Field label="Endpoint" value={preview.endpoint} mono />
      <p className="text-xs text-muted-foreground">
        Compare the fingerprint with what the other machine shows before
        confirming — this is what pairing exists to protect.
      </p>
    </div>
  );
}

function KeyMismatchCard({ existingLabel }: { existingLabel: string }) {
  return (
    <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
      <p className="font-medium text-destructive">
        Fingerprint doesn&apos;t match
      </p>
      <p className="text-muted-foreground">
        We already know a machine called &quot;{existingLabel}&quot; under this
        id, with a different key. That means either it was reinstalled, or
        something is impersonating it.
      </p>
    </div>
  );
}

function AdvertisedEndpoints({ endpoints }: { endpoints: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDownIcon
          className={`size-3.5 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
        What this machine advertises back
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 text-sm text-muted-foreground">
        {endpoints.length > 0 ? (
          <p className="font-mono text-xs">{endpoints.join(', ')}</p>
        ) : (
          <p>
            Nothing — accepting connections is off, so this machine cannot be
            dialled back. Advertising an endpoint just tells the other side
            where it may try to reach this one.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({
  label,
  value,
  mono,
  selectable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  selectable?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`${mono ? 'font-mono' : ''} ${
          selectable ? 'select-all' : ''
        } text-sm text-foreground`}
      >
        {value}
      </p>
    </div>
  );
}
