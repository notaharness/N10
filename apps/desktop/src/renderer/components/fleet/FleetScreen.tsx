import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { TitleBar } from '../TitleBar.js';
import { Button } from '../ui/button.js';
import { FleetOverview } from './FleetOverview.js';

/** Fleet, full height over the screen underneath (`FleetOver`). */
export function FleetScreen() {
  const { close } = useFleet();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background text-foreground">
      <TitleBar repo={null} onSwitchRepo={() => undefined} />
      <section aria-label="Fleet" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={close}>
            <ArrowLeftIcon />
            Back to workspace
          </Button>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-3 text-xl font-semibold outline-none"
          >
            Fleet
          </h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Connect your machines with beam. Run shells, commands and agent
            messages between them.
          </p>
          <FleetOverview />
        </div>
      </section>
    </div>
  );
}
