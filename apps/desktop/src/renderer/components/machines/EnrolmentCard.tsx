import { useState } from 'react';
import { ceremonyOutcomeText } from '../../lib/machines/ceremony-model.js';
import type { useCeremony } from '../../lib/machines/use-ceremony.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { CeremonyPanel } from './CeremonyPanel.js';

/**
 * First run on an unenrolled daemon (beam docs/08): one card that
 * creates a fleet on this machine or joins it to the owner's fleet,
 * each one passkey ceremony. An empty label lets beam default to the
 * host name; an empty fleet name, to `beam`.
 */
export function EnrolmentCard({
  ceremony,
}: {
  ceremony: ReturnType<typeof useCeremony>;
}) {
  const [label, setLabel] = useState('');
  const [fleetName, setFleetName] = useState('');
  const { view, running, outcome, start, cancel } = ceremony;
  const started = running || outcome !== null;

  return (
    <div className="space-y-4 px-4 py-4">
      <p className="text-sm text-muted-foreground">
        beam connects the machines you own: shells, commands and messages
        between them. A fleet is created once, with a passkey; every other
        machine joins it with the same passkey.
      </p>
      <div className="grid max-w-md gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="beam-label">This machine&apos;s name</Label>
          <Input
            id="beam-label"
            value={label}
            placeholder="its host name"
            disabled={running}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="beam-fleet-name">Fleet name (to create one)</Label>
          <Input
            id="beam-fleet-name"
            value={fleetName}
            placeholder="beam"
            disabled={running}
            onChange={(e) => setFleetName(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={running}
          onClick={() => start({ op: 'init', label, fleetName })}
        >
          Create a fleet
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={running}
          onClick={() => start({ op: 'join', label })}
        >
          Join my fleet
        </Button>
      </div>
      {started && (
        <CeremonyPanel
          view={view}
          running={running}
          outcome={outcome}
          outcomeText={outcome ? ceremonyOutcomeText(outcome) : null}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
