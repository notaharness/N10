import { useState } from 'react';
import { toast } from 'sonner';
import {
  useConfirmPairing,
  usePreviewPairing,
} from '../../lib/data/mutations-machines.js';
import { useMachines } from '../../lib/data/queries.js';
import type {
  PairConfirmResult,
  PairFailure,
  PairPreviewResult,
} from '../../../host/contract-machines.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { Input } from '../ui/input.js';
import { PairDialogBody } from './PairDialogBody.js';

interface PairDialogView {
  /** Shown separately, with its own destructive treatment. */
  keyMismatch: (PairFailure & { reason: 'key-mismatch' }) | null;
  /** Any other failure, from either step. */
  failure: PairFailure | null;
  /** The descriptor is in hand and nothing more urgent is showing. */
  showPreview: boolean;
}

/** What the dialog is showing, derived from the two mutations' results —
 *  pulled out of the component so the branching lives in one place the
 *  render logic just reads, rather than five inline ternaries. */
function pairDialogView(
  preview: PairPreviewResult | undefined,
  confirm: PairConfirmResult | undefined
): PairDialogView {
  if (confirm && !confirm.ok) {
    if (confirm.failure.reason === 'key-mismatch') {
      return {
        keyMismatch: confirm.failure as PairFailure & {
          reason: 'key-mismatch';
        },
        failure: null,
        showPreview: false,
      };
    }
    return { keyMismatch: null, failure: confirm.failure, showPreview: false };
  }
  if (preview && !preview.ok) {
    return { keyMismatch: null, failure: preview.failure, showPreview: false };
  }
  return {
    keyMismatch: null,
    failure: null,
    showPreview: preview?.ok ?? false,
  };
}

/**
 * "Add a machine": this desktop dials out. The two-step confirm is the
 * whole security value of trust-on-first-use (ux-machines.md §3) —
 * pasting a URL only ever fetches and shows what it names; nothing is
 * stored, and the token is not spent, until the user confirms what
 * they see.
 */
export function PairMachineDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const preview = usePreviewPairing();
  const confirm = useConfirmPairing();
  const machines = useMachines();
  const localEndpoints = machines.data?.find((m) => m.isLocal)?.endpoints ?? [];

  const view = pairDialogView(preview.data, confirm.data);

  const resetOnEdit = (next: string) => {
    setUrl(next);
    if (preview.data || confirm.data) {
      preview.reset();
      confirm.reset();
    }
  };

  const doPreview = () => {
    const trimmed = url.trim();
    if (trimmed) preview.mutate(trimmed);
  };

  const doConfirm = (force: boolean) => {
    confirm.mutate(
      { url: url.trim(), force },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Paired with ${result.machine.label}`);
            onClose();
          }
        },
        onError: (err: unknown) => toast.error(errorMessage(err)),
      }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          if (view.showPreview) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add a machine</DialogTitle>
          <DialogDescription>
            Paste the pairing URL the other machine printed when it turned on
            accepting connections.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="http://…/pair#token=…"
          value={url}
          onChange={(e) => resetOnEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !view.showPreview) doPreview();
          }}
          className="font-mono text-sm"
        />

        <PairDialogBody
          view={view}
          preview={preview.data}
          localEndpoints={localEndpoints}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {view.keyMismatch ? (
            <Button
              variant="destructive"
              disabled={confirm.isPending}
              onClick={() => doConfirm(true)}
            >
              Replace the stored key
            </Button>
          ) : view.showPreview ? (
            <Button
              disabled={confirm.isPending}
              onClick={() => doConfirm(false)}
            >
              {confirm.isPending ? 'Pairing…' : 'Pair'}
            </Button>
          ) : (
            <Button
              disabled={!url.trim() || preview.isPending}
              onClick={doPreview}
            >
              {preview.isPending ? 'Checking…' : 'Continue'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
