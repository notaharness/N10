import { ArrowLeftIcon, NetworkIcon } from 'lucide-react';
import { Button } from '../ui/button.js';
import { MachineRows } from '../settings/MachineRows.js';

export function FleetView({ onBack }: { onBack: () => void }) {
  return (
    <>
      <header className="app-drag flex h-9 shrink-0 items-center border-b border-border bg-titlebar px-4">
        <Button
          className="app-no-drag"
          variant="ghost"
          size="sm"
          onClick={onBack}
        >
          <ArrowLeftIcon /> Back to workspace
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto" aria-label="Fleet">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div>
            <h1
              tabIndex={-1}
              className="flex items-center gap-2 text-2xl font-semibold"
            >
              <NetworkIcon /> Fleet
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect your machines with beam. Run shells, commands and agent
              messages between them.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <MachineRows />
          </div>
        </div>
      </main>
    </>
  );
}
