import { useState } from 'react';
import { ceremonyOutcomeText } from '../../lib/machines/ceremony-model.js';
import type { useCeremony } from '../../lib/machines/use-ceremony.js';
import { Button } from '../ui/button.js';
import { CeremonyPanel } from './CeremonyPanel.js';
import { EnrolmentForm, EnrolmentPlan } from './EnrolmentForm.js';
import { PasskeyCompatibility } from './PasskeyCompatibility.js';

const TITLES = {
  choose: 'Connect your first machine',
  init: 'Create a fleet',
  join: 'Join an existing fleet',
};

export function EnrolmentCard({
  ceremony,
}: {
  ceremony: ReturnType<typeof useCeremony>;
}) {
  const [mode, setMode] = useState<'init' | 'join' | null>(null);
  const { view, running, outcome, cancel } = ceremony;
  const failed = outcome?.ok === false;
  return (
    <div className="space-y-5 p-5">
      <h2 className="text-lg font-semibold">{TITLES[mode ?? 'choose']}</h2>
      <p className="text-sm text-muted-foreground">
        Create a fleet once. On your other machines, join it with the same
        passkey. Members can run commands as your user unless you restrict their
        access.
      </p>
      {mode ? (
        <>
          <EnrolmentPlan mode={mode} />
          <EnrolmentForm
            mode={mode}
            ceremony={ceremony}
            onBack={() => {
              ceremony.clear();
              setMode(null);
            }}
          />
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode('init')}>Create a fleet</Button>
          <Button variant="outline" onClick={() => setMode('join')}>
            Join an existing fleet
          </Button>
        </div>
      )}
      <CeremonyPanel
        view={view}
        running={running}
        outcome={outcome}
        outcomeText={outcome ? ceremonyOutcomeText(outcome) : null}
        onCancel={cancel}
        operation={mode ?? 'join'}
      />
      {mode === 'init' && failed && (
        <p className="text-sm text-muted-foreground">
          If you saved a passkey before this stopped, it may still be in your
          passkey manager. It does not mean a fleet was created. Check this
          machine’s status before trying again.
        </p>
      )}
      <PasskeyCompatibility
        expanded={failed && outcome.code === 'prf-unsupported'}
      />
    </div>
  );
}
