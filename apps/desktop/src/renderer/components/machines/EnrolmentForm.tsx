import { useState } from 'react';
import {
  NAME_HINT,
  validBeamName,
} from '../../lib/machines/enrolment-model.js';
import type { useCeremony } from '../../lib/machines/use-ceremony.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';

export function EnrolmentPlan({ mode }: { mode: 'init' | 'join' }) {
  if (mode === 'join')
    return (
      <p className="text-sm">
        Use the passkey you created for this fleet. One passkey prompt
        authorizes this machine.
      </p>
    );
  return (
    <div className="space-y-2 text-sm">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Create your fleet passkey</strong> — save a new passkey for
          beam.n10.is.
        </li>
        <li>
          <strong>Authorize this machine</strong> — use that same passkey to
          sign its membership and unlock the encrypted directory.
        </li>
      </ol>
      <p>
        Two passkey prompts, once per fleet. Each prompt has its own link and QR
        code.
      </p>
    </div>
  );
}

/** Remains mounted during the request so a failure preserves both names. */
export function EnrolmentForm({
  mode,
  ceremony,
  onBack,
}: {
  mode: 'init' | 'join';
  ceremony: ReturnType<typeof useCeremony>;
  onBack: () => void;
}) {
  const [label, setLabel] = useState('');
  const [fleetName, setFleetName] = useState('');
  const { running, outcome, start } = ceremony;
  const valid =
    validBeamName(label) && (mode !== 'init' || validBeamName(fleetName));
  const submit = () => {
    if (!valid) return;
    start(
      mode === 'init' ? { op: mode, label, fleetName } : { op: mode, label }
    );
  };
  if (running) return null;
  const buttonLabel = outcome
    ? 'Try again'
    : { init: 'Create fleet', join: 'Join fleet' }[mode];
  return (
    <>
      <div className="grid max-w-md gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="beam-label">This machine’s name</Label>
          <Input
            id="beam-label"
            value={label}
            placeholder="Host name"
            onChange={(e) => setLabel(e.target.value)}
            aria-describedby="beam-name-hint"
          />
        </div>
        {mode === 'init' && (
          <div className="grid gap-1.5">
            <Label htmlFor="beam-fleet-name">Fleet name</Label>
            <Input
              id="beam-fleet-name"
              value={fleetName}
              placeholder="beam"
              onChange={(e) => setFleetName(e.target.value)}
              aria-describedby="beam-name-hint"
            />
            <p className="text-xs text-muted-foreground">
              The fleet name appears in your passkey manager.
            </p>
          </div>
        )}
        <p
          id="beam-name-hint"
          className={
            valid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'
          }
        >
          {NAME_HINT}
        </p>
      </div>
      <div className="flex gap-2">
        <Button disabled={!valid} onClick={submit}>
          {buttonLabel}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}
