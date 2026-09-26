import { ClockIcon, FolderOpenIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RepoInfo } from '../../host/contract.js';
import { FleetSection } from '../components/fleet/FleetSection.js';
import { N10Mark } from '../components/N10Mark.js';
import { TitleBar } from '../components/TitleBar.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { useRecentRepos } from '../lib/data/queries.js';
import { basename, errorMessage, relativeTime } from '../lib/utils.js';

/** Repo gate / switcher: open a folder, paste a path, or pick a recent. */
export function RepoOpen({ onOpened }: { onOpened: (repo: RepoInfo) => void }) {
  const recents = useRecentRepos();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async (target?: string) => {
    const cwd = (target ?? path).trim();
    if (!cwd) return;
    setBusy(true);
    try {
      onOpened(await window.n10.openRepo(cwd));
    } catch (err: unknown) {
      toast.error(errorMessage(err));
      void recents.refetch();
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    try {
      const dir = await window.n10.selectRepoDirectory();
      if (dir) void open(dir);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const list = recents.data ?? [];

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar repo={null} onSwitchRepo={() => undefined} />
      <div className="flex min-h-0 flex-1">
        {/* The same Fleet section the workspace's sidebar holds: a fleet
          belongs to the machine, not to a repository. */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar pt-2 text-sidebar-foreground">
          <FleetSection />
        </aside>
        <main className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="grid w-full max-w-3xl grid-cols-[1fr_1.1fr] gap-10">
            <section className="flex flex-col justify-center">
              <div className="flex items-center gap-3">
                <N10Mark className="size-10" />
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">n10</h1>
                  <p className="text-sm text-muted-foreground">
                    Worktrees, agents and reviews for one repository.
                  </p>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => void pickFolder()}
                  disabled={busy}
                >
                  <FolderOpenIcon /> {busy ? 'Opening…' : 'Open repository…'}
                </Button>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void open();
                  }}
                >
                  <Input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/path/to/repository"
                    className="h-9 font-mono"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="lg"
                    disabled={busy || !path.trim()}
                  >
                    Open
                  </Button>
                </form>
              </div>
            </section>

            <section className="flex min-h-64 flex-col rounded-lg border border-border bg-card">
              <div className="flex h-9 items-center gap-2 border-b border-border px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ClockIcon className="size-3.5" /> Recent
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {recents.isLoading && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Loading…
                  </p>
                )}
                {!recents.isLoading && list.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Repositories you open will show up here.
                  </p>
                )}
                {list.map((r) => (
                  <div
                    key={r.cwd}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <button
                      type="button"
                      onClick={() => void open(r.cwd)}
                      disabled={!r.valid || busy}
                      className="min-w-0 flex-1 text-left disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-medium">
                          {basename(r.cwd)}
                        </span>
                        {!r.valid && (
                          <span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            missing
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {relativeTime(r.lastOpenedAt)}
                        </span>
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {r.cwd}
                      </p>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove from recent"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() =>
                        void window.n10
                          .forgetRecent(r.cwd)
                          .then(() => recents.refetch())
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
