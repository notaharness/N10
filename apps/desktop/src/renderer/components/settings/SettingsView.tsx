import { useState } from 'react';
import { useRepo } from '../../lib/repo-context.js';
import { useSettingsView } from '../../lib/data/queries.js';
import {
  visibleSettingsGroups,
  type GroupKey,
} from '../../lib/settings-groups.js';
import { cn } from '../../lib/utils.js';
import { Skeleton } from '../ui/skeleton.js';
import { AppearanceRows } from './AppearanceRows.js';
import { FieldRow } from './FieldRow.js';
import { MachineRows } from './MachineRows.js';

/**
 * Settings page: group navigation on the left, one card per group on
 * the right. Fields come from the CLI's own catalog (host-side); only
 * the Appearance group is desktop-local.
 */
export function SettingsView() {
  const { repo } = useRepo();
  const view = useSettingsView(repo.cwd);
  const [activeGroup, setActiveGroup] = useState<GroupKey>('appearance');

  const visibleGroups = visibleSettingsGroups(view.data);

  const jump = (key: GroupKey) => {
    setActiveGroup(key);
    document
      .getElementById(`settings-${key}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-44 shrink-0 border-r border-border bg-sidebar/60 py-3">
        {visibleGroups.map((g) => (
          <button
            type="button"
            key={g.key}
            onClick={() => jump(g.key)}
            className={cn(
              'flex h-7 w-full items-center px-4 text-base transition-colors hover:bg-accent',
              activeGroup === g.key
                ? 'border-l-2 border-primary bg-sidebar-active font-medium text-foreground'
                : 'border-l-2 border-transparent text-muted-foreground'
            )}
          >
            {g.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored in <span className="font-mono">~/.n10</span> and the
            repository's <span className="font-mono">.n10/</span> — shared with
            the n10 terminal UI.
          </p>

          {view.isLoading && (
            <div className="mt-6 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {view.error && (
            <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {String(view.error.message)}
            </div>
          )}

          {visibleGroups.map((g) => (
            <section
              key={g.key}
              id={`settings-${g.key}`}
              className="scroll-mt-4 pt-8"
            >
              <h2 className="text-lg font-semibold">{g.label}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{g.blurb}</p>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {g.key === 'appearance' ? (
                  <AppearanceRows />
                ) : g.key === 'machines' ? (
                  <MachineRows />
                ) : (
                  g.fields.map((f) => (
                    <FieldRow
                      key={`${f.key}:${f.label}`}
                      field={f}
                      updatedAt={view.dataUpdatedAt}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
          <div className="h-16" />
        </div>
      </div>
    </div>
  );
}
