import { GitBranch, GitPullRequest, Terminal, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { itemOf } from '@/components/demo/items';

/**
 * The open tabs, as an ARIA tablist: one tab stop, arrow keys, Home
 * and End move and select, Delete (or Backspace) closes. The × on each
 * tab is for the mouse and is hidden from assistive tech, which has
 * Delete instead. Closing needs the sidebar on screen to reopen a tab,
 * so both only work from md up.
 */
const SIDEBAR_SHOWN = '(min-width: 48rem)';
export const tabId = (id: string) => `demo-tab-${id}`;
export const PANEL_ID = 'demo-panel';

function TabIcon({ id }: { id: string }) {
  const item = itemOf(id);
  const Icon =
    item.session === 'zsh' ? Terminal : item.pr ? GitPullRequest : GitBranch;
  return (
    <Icon className="text-fd-muted-foreground size-3.5 shrink-0" aria-hidden />
  );
}

export function DemoTabs({
  open,
  active,
  onSelect,
  onClose,
}: {
  open: readonly string[];
  active: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const focusTab = (id: string | undefined) => {
    if (!id) return;
    onSelect(id);
    document.getElementById(tabId(id))?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, id: string) => {
    const at = open.indexOf(id);
    const keys: Record<string, () => void> = {
      ArrowRight: () => focusTab(open[(at + 1) % open.length]),
      ArrowLeft: () => focusTab(open[(at - 1 + open.length) % open.length]),
      Home: () => focusTab(open[0]),
      End: () => focusTab(open[open.length - 1]),
    };
    const closable = window.matchMedia(SIDEBAR_SHOWN).matches;
    if (closable)
      keys.Delete = keys.Backspace = () => {
        onClose(id);
        focusTab(open[at + 1] ?? open[at - 1]);
      };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };
  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="border-fd-border flex h-9 shrink-0 overflow-x-auto border-b text-[13px] [scrollbar-width:none]"
    >
      {open.map((id) => {
        const selected = id === active;
        const title = itemOf(id).title;
        return (
          <div
            key={id}
            role="presentation"
            className={`border-fd-border group relative flex shrink-0 items-center border-r ${
              selected ? 'bg-fd-background' : 'text-fd-muted-foreground'
            }`}
          >
            {selected && (
              <span className="bg-fd-primary absolute inset-x-0 top-0 h-0.5" />
            )}
            <button
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={selected}
              aria-controls={PANEL_ID}
              aria-keyshortcuts="Delete Backspace"
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(id)}
              onKeyDown={(event) => onKeyDown(event, id)}
              className="focus-visible:ring-fd-ring flex h-full items-center gap-1.5 py-0 pr-1 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-inset md:pr-7"
            >
              <TabIcon id={id} />
              <span className="max-w-40 truncate">{title}</span>
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => onClose(id)}
              className="hover:bg-fd-accent absolute right-1.5 hidden size-5 items-center justify-center rounded md:flex"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
