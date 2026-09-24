import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { N10HostApi, RepoInfo } from '../host/contract.js';
import { FleetScreen } from './components/fleet/FleetScreen.js';
import { Toaster } from './components/ui/sonner.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import {
  keys,
  queryClient,
  resetRepoScopedCache,
} from './lib/data/query-keys.js';
import { useRepoGate } from './lib/data/queries.js';
import { FleetProvider, useFleet } from './lib/fleet/fleet-context.js';
import { errorMessage } from './lib/utils.js';
import { RepoOpen } from './screens/RepoOpen.js';
import { Workspace } from './screens/Workspace.js';
import { TabsProvider } from './lib/tabs/tabs.js';
import { useRepoFollowsTabs } from './lib/tabs/use-repo-follows-tabs.js';

declare global {
  interface Window {
    n10: N10HostApi;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* Above the gate on purpose: the tab strip spans repositories,
            so switching repos must not unmount the tabs of the one being
            left — their agents keep running and stay in the strip. */}
        <TabsProvider>
          <FleetProvider>
            <FleetOver>
              <Gate />
            </FleetOver>
          </FleetProvider>
        </TabsProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Fleet over the screen underneath, which stays mounted but hidden
 *  and inert: `visibility`, not unmounting, keeps its terminals sized. */
function FleetOver({ children }: { children: ReactNode }) {
  const { open } = useFleet();
  return (
    <>
      <div className={open ? 'invisible' : undefined} inert={open}>
        {children}
      </div>
      {open && <FleetScreen />}
    </>
  );
}

function Gate() {
  const qc = useQueryClient();
  const { data: repo, isPending } = useRepoGate();

  /** Adopt a repository the host has already switched to. */
  const adoptRepo = useCallback(
    (r: RepoInfo) => {
      resetRepoScopedCache(qc);
      qc.setQueryData(keys.repo, r);
    },
    [qc]
  );

  /** Open a repository in place, reporting whether it worked. */
  const openRepoAsync = useCallback(
    async (cwd: string): Promise<boolean> => {
      try {
        adoptRepo(await window.n10.openRepo(cwd));
        return true;
      } catch (err: unknown) {
        toast.error(errorMessage(err));
        return false;
      }
    },
    [adoptRepo]
  );

  const openRepo = useCallback(
    (cwd: string) => void openRepoAsync(cwd),
    [openRepoAsync]
  );

  // A tab from another repository is shown by opening that repository.
  useRepoFollowsTabs(repo?.cwd ?? null, openRepoAsync);

  const pickRepoFolder = useCallback(() => {
    window.n10
      .selectRepoDirectory()
      .then((dir) => {
        if (dir) openRepo(dir);
      })
      .catch((err: unknown) => toast.error(errorMessage(err)));
  }, [openRepo]);

  if (isPending) {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <p className="animate-pulse text-sm text-muted-foreground">
          Connecting to host…
        </p>
      </main>
    );
  }

  if (!repo) {
    return <RepoOpen onOpened={adoptRepo} />;
  }

  return (
    <Workspace
      key={repo.cwd}
      repo={repo}
      onSwitchRepo={() => qc.setQueryData(keys.repo, null)}
      onOpenRepo={openRepo}
      onPickRepoFolder={pickRepoFolder}
    />
  );
}
