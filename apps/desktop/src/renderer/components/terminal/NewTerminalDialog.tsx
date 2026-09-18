import {
  BotIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import { useRef, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import type { LaunchStep, TerminalKind } from '../../../host/contract.js';
import { useRecentRepos } from '../../lib/data/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { basename, errorMessage } from '../../lib/utils.js';
import {
  MachineChoiceSelect,
  RemoteLaunchProgress,
  useMachineChoice,
} from './NewTerminalMachineChoice.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';

/** Where the terminal opens, once the user has said. */
type Where =
  | { kind: 'current'; cwd: string }
  | { kind: 'repo'; cwd: string }
  | { kind: 'folder'; cwd: string };

/** The recents list: closed, or open by whichever means opened it —
 *  opened from the keyboard, its first entry takes focus as it mounts. */
type RepoList = 'closed' | 'mouse' | 'keyboard';

/**
 * Whether a click came from the keyboard — Enter or Space on the
 * focused choice — rather than the pointer. The browser counts pointer
 * presses in `detail`; a synthesized click from a key has none. This
 * is what decides whether choosing moves focus on to the next step:
 * derived from the event itself, so nothing outlives a choice that
 * never completed (a folder picker that was cancelled).
 */
function fromKeyboard(e: MouseEvent<HTMLElement>): boolean {
  return e.detail === 0;
}

function focusFirst(root: HTMLElement | null): void {
  root?.querySelector<HTMLElement>('[role="radio"]')?.focus();
}

/** The chosen item of a step, or its first when nothing is chosen. */
function focusChosen(root: HTMLElement | null): void {
  const chosen = root?.querySelector<HTMLElement>('[data-state="on"]');
  if (chosen) chosen.focus();
  else focusFirst(root);
}

/**
 * "New terminal": where, then what.
 *
 * Where is one of the open repository's root, another repository from
 * the recents list, or any folder through the OS picker. What is a
 * plain shell or the configured agent. The host decides which group
 * the resulting tab belongs to from the directory itself.
 *
 * Each step is a toggle group with a roving focus: the arrows walk its
 * choices (wrapping), Home/End jump, Enter chooses. Focus opens on the
 * first "where" choice. Choosing a "where" from the keyboard moves
 * focus on to "what" (or into the repository list), and choosing a
 * "what" from the keyboard opens the terminal as that kind — the two
 * Enters of the two steps. A click chooses and leaves focus where the
 * pointer put it; the footer button is the mouse's way to the launch.
 */
export function NewTerminalDialog({
  onLaunch,
  onClose,
  busy,
  remoteStep,
  remoteError,
}: {
  onLaunch: (kind: TerminalKind, cwd: string, machine?: string) => void;
  onClose: () => void;
  busy: boolean;
  /** Set only during a remote launch (ux-machines.md §5). */
  remoteStep?: LaunchStep | null;
  remoteError?: string | null;
}) {
  const { repo } = useRepo();
  const [where, setWhere] = useState<Where | null>({
    kind: 'current',
    cwd: repo.cwd,
  });
  const [what, setWhat] = useState<TerminalKind>('shell');
  const [repoList, setRepoList] = useState<RepoList>('closed');
  const whereRef = useRef<HTMLDivElement>(null);
  const whatRef = useRef<HTMLDivElement>(null);
  const machineChoice = useMachineChoice();

  /** Answer "where"; from the keyboard, move on to "what". */
  const choose = (next: Where, advance: boolean) => {
    setRepoList('closed');
    setWhere(next);
    if (advance) focusChosen(whatRef.current);
  };

  const pickFolder = async (advance: boolean) => {
    try {
      const dir = await window.n10.selectFolder();
      if (dir) choose({ kind: 'folder', cwd: dir }, advance);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const go = (kind: TerminalKind = what) => {
    if (where) onLaunch(kind, where.cwd, machineChoice.selectedMachine());
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusFirst(whereRef.current);
        }}
      >
        <DialogHeader>
          <DialogTitle>New terminal</DialogTitle>
          <DialogDescription>
            A shell or an agent, in any directory — without leaving n10.
          </DialogDescription>
        </DialogHeader>

        <p className="text-base">Where?</p>
        <ToggleGroup
          type="single"
          value={where?.kind ?? ''}
          loop
          ref={whereRef}
          aria-label="Where"
          className="flex-col gap-2"
        >
          <Choice
            value="current"
            onActivate={(kb) => choose({ kind: 'current', cwd: repo.cwd }, kb)}
            icon={GitBranchIcon}
            title="Current repository"
            description={repo.cwd}
          />
          <Choice
            value="repo"
            onActivate={(kb) => setRepoList(kb ? 'keyboard' : 'mouse')}
            icon={FolderIcon}
            title="Other repository"
            description={
              where?.kind === 'repo' ? where.cwd : 'One you have opened before'
            }
          />
          {repoList !== 'closed' && (
            <RepoList
              exclude={repo.cwd}
              autoFocus={repoList === 'keyboard'}
              onPick={(cwd, kb) => choose({ kind: 'repo', cwd }, kb)}
            />
          )}
          <Choice
            value="folder"
            // The picker is reached through the choice's own click,
            // whichever way it was activated.
            onActivate={(kb) => void pickFolder(kb)}
            icon={FolderOpenIcon}
            title="Other folder…"
            description={
              where?.kind === 'folder'
                ? where.cwd
                : 'Any directory, repository or not'
            }
          />
        </ToggleGroup>

        <p className="text-base">What?</p>
        <ToggleGroup
          type="single"
          value={what}
          loop
          ref={whatRef}
          aria-label="What"
          className="grid grid-cols-2 gap-2"
        >
          <Choice
            value="shell"
            onActivate={(kb) => (kb ? go('shell') : setWhat('shell'))}
            icon={SquareTerminalIcon}
            title="Shell"
            description="Your login shell"
          />
          <Choice
            value="agent"
            onActivate={(kb) => (kb ? go('agent') : setWhat('agent'))}
            icon={BotIcon}
            title="Agent"
            description="The configured agent, no task"
          />
        </ToggleGroup>

        <MachineChoiceSelect id="new-terminal-machine" choice={machineChoice} />

        {/* Finding 5: the folder choices above, "Other folder…" above
         *  all, are browsed on THIS machine — there is no remote folder
         *  picker (a known limitation) — so a directory picked here is
         *  sent to the chosen machine as a plain path, which resolves
         *  or fails against its own filesystem, not this one's. */}
        {machineChoice.selectedMachine() && (
          <p className="text-sm text-muted-foreground">
            Folders above are on this machine, not{' '}
            {machineChoice.selectedLabel()}
            's — it will open the same path there, or fail if that path doesn't
            exist on it.
          </p>
        )}

        <RemoteLaunchProgress
          step={remoteStep}
          error={remoteError}
          machineLabel={machineChoice.selectedLabel()}
          what={what === 'agent' ? 'agent' : 'shell'}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => go()} disabled={!where || busy}>
            Open terminal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The recents list, minus the repository already on offer. Its own
 *  group: nothing is chosen in it, and choosing answers "where". The
 *  list is a query, so with `autoFocus` the first entry takes focus
 *  whenever it actually mounts — which may be a fetch after the
 *  keyboard asked for the list, not the same render. */
function RepoList({
  exclude,
  autoFocus,
  onPick,
}: {
  exclude: string;
  autoFocus: boolean;
  onPick: (cwd: string, fromKeyboard: boolean) => void;
}) {
  const recents = useRecentRepos();
  const list = (recents.data ?? []).filter((r) => r.valid && r.cwd !== exclude);
  if (list.length === 0) {
    return (
      <p className="px-3 py-1 text-sm text-muted-foreground">
        No other repositories opened yet.
      </p>
    );
  }
  return (
    <ToggleGroup
      type="single"
      value=""
      loop
      aria-label="Repositories"
      className="max-h-40 flex-col overflow-y-auto rounded-md border border-border"
    >
      {list.map((r, i) => (
        <ToggleGroupItem
          key={r.cwd}
          value={r.cwd}
          autoFocus={autoFocus && i === 0}
          onClick={(e) => {
            e.preventDefault();
            onPick(r.cwd, fromKeyboard(e));
          }}
          className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-accent"
        >
          <span className="font-medium">{basename(r.cwd)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {r.cwd}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Choice({
  value,
  onActivate,
  icon: Icon,
  title,
  description,
}: {
  value: string;
  /** Called on a click, with whether the keyboard caused it. */
  onActivate: (fromKeyboard: boolean) => void;
  icon: typeof FolderIcon;
  title: string;
  description: string;
}) {
  return (
    <ToggleGroupItem
      value={value}
      // Chosen here, not by the group's own toggle: the group's value is
      // the dialog's state, and a second click on the chosen item must
      // not clear it.
      onClick={(e) => {
        e.preventDefault();
        onActivate(fromKeyboard(e));
      }}
      className="group flex w-full items-start gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent data-[state=on]:border-primary data-[state=on]:bg-primary/10"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-data-[state=on]:text-primary" />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </ToggleGroupItem>
  );
}
