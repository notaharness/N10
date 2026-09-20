import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from '../../lib/data/query-keys.js';
import { useAgentConfigDirs } from '../../lib/data/queries.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { RowShell } from './RowShell.js';

/**
 * Registered Claude configuration directories — one row per token,
 * plus a row to add another. Desktop-only: a directory is a property
 * of this machine, not something the shared settings catalog (which
 * the CLI reads too) has any business carrying.
 */
export function ClaudeConfigDirRows() {
  const qc = useQueryClient();
  const dirs = useAgentConfigDirs();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: keys.agentConfigDirs });

  const register = useMutation({
    mutationFn: (dir: string) => window.n10.registerAgentConfigDir(dir),
    onSuccess: () => {
      toast.success('Configuration directory registered');
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const forget = useMutation({
    mutationFn: (dir: string) => window.n10.forgetAgentConfigDir(dir),
    onSuccess: () => {
      toast.success('Configuration directory removed');
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      {(dirs.data ?? []).map((dir, i) => (
        <RowShell
          key={dir}
          label={i === 0 ? 'Default' : 'Directory'}
          description={
            i === 0
              ? 'Used unless a launch picks another directory.'
              : configDirDescription(dir)
          }
          control={
            <>
              <span className="font-mono text-sm">{dir}</span>
              {i > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${dir}`}
                  disabled={forget.isPending}
                  onClick={() => forget.mutate(dir)}
                >
                  <Trash2Icon />
                </Button>
              )}
            </>
          }
        />
      ))}
      <AddConfigDirRow
        busy={register.isPending}
        onAdd={(dir) => register.mutate(dir)}
      />
    </>
  );
}

function configDirDescription(dir: string): string {
  return dir.startsWith('~/')
    ? 'Stored relative to your home directory, so it means the same directory on another machine.'
    : 'Outside your home directory, so it names this machine only.';
}

function AddConfigDirRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (dir: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft('');
  };
  return (
    <RowShell
      label="Add directory"
      description="An absolute path, or one under your home directory (e.g. ~/.claude-work)."
      control={
        <>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="~/.claude-work"
            className="w-56 font-mono"
            disabled={busy}
          />
          <Button size="sm" onClick={add} disabled={busy || !draft.trim()}>
            Add
          </Button>
        </>
      }
    />
  );
}
