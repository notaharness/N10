'use client';

import {
  GitBranch,
  Menu,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Terminal,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { ClaudeSession } from '@/components/demo/claude-session';
import { DemoSidebar } from '@/components/demo/demo-sidebar';
import { PanelHeader, TerminalScreen } from '@/components/demo/demo-panel';
import { DemoTabs, PANEL_ID, tabId } from '@/components/demo/demo-tabs';
import {
  FIRST_TABS,
  ITEMS,
  itemOf,
  type DemoItem,
} from '@/components/demo/items';
import { claudeAt, type ClaudeView } from '@/components/demo/model';
import { useDemoClock } from '@/components/demo/use-demo-clock';
import { runZsh, ZSH_HISTORY } from '@/components/demo/zsh';
import { ZshSession } from '@/components/demo/zsh-session';

/**
 * n10 Desktop in miniature for the landing page: the repository
 * sidebar, a tab per open worktree or pull request, and a terminal in
 * each, with scripted Claude Code sessions and a zsh. Nothing runs and
 * nothing is fetched; the scripts live in this directory. Below md the
 * sidebar folds away and the tabs carry the demo on their own.
 */
const ZSH_INPUT = 'demo-zsh-input';

function TitleBar() {
  return (
    <div
      aria-hidden
      className="border-fd-border text-fd-muted-foreground flex h-9 items-center gap-2 border-b px-3 text-[13px]"
    >
      <Menu className="size-4" />
      <span className="bg-fd-primary text-fd-primary-foreground flex size-5 items-center justify-center rounded">
        <GitBranch className="size-3" />
      </span>
      <span className="text-fd-foreground">atlas</span>
      <div className="border-fd-border bg-fd-background mx-auto hidden h-6 w-full max-w-sm items-center gap-2 rounded-md border px-2 text-xs sm:flex">
        <Search className="size-3" />
        <span className="flex-1 truncate">
          Search branches, pull requests, commands…
        </span>
        <kbd className="font-sans">Ctrl K</kbd>
      </div>
      <Moon className="ml-auto size-4 sm:ml-0" />
      <Settings className="size-4" />
    </div>
  );
}

function StatusBar({ running }: { running: number }) {
  return (
    <div
      aria-hidden
      className="border-fd-border text-fd-muted-foreground flex h-6 items-center gap-3 border-t px-3 text-[11px]"
    >
      <span className="flex items-center gap-1">
        <GitBranch className="size-3" /> atlas
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <RefreshCw className="size-3" /> GitHub <span>synced just now</span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Terminal className="size-3" /> {running} running
      </span>
      <span>v1.0.0</span>
    </div>
  );
}

function useTabs() {
  const [open, setOpen] = useState<readonly string[]>(FIRST_TABS);
  const [active, setActive] = useState<string | null>(FIRST_TABS[0] ?? null);
  const openItem = (id: string) => {
    setOpen((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setActive(id);
  };
  const close = (id: string) => {
    const at = open.indexOf(id);
    const rest = open.filter((tab) => tab !== id);
    setOpen(rest);
    if (active === id) setActive(rest[at] ?? rest[at - 1] ?? null);
  };
  return { open, active, openItem, select: setActive, close };
}

function useZsh() {
  const [history, setHistory] = useState(() =>
    ZSH_HISTORY.map((entry, id) => ({ ...entry, id }))
  );
  const run = (line: string) => {
    const entry = runZsh(line);
    setHistory((h) =>
      entry ? [...h, { ...entry, id: (h[h.length - 1]?.id ?? 0) + 1 }] : []
    );
  };
  return { history, run };
}

type Clock = ReturnType<typeof useDemoClock>;
type Zsh = ReturnType<typeof useZsh>;

function viewsAt(clock: Clock): Record<string, ClaudeView | undefined> {
  const views: Record<string, ClaudeView | undefined> = {};
  for (const item of ITEMS) {
    if (item.session === 'zsh') continue;
    views[item.id] = claudeAt(
      item.session,
      clock.timeOf(item.id, item.session),
      clock.answers[item.id]
    );
  }
  return views;
}

function Screen({
  item,
  view,
  clock,
  zsh,
}: {
  item: DemoItem;
  view?: ClaudeView;
  clock: Clock;
  zsh: Zsh;
}) {
  if (view && item.session !== 'zsh') {
    return (
      <TerminalScreen
        label={`Claude Code in ${item.branch}`}
        version={`${view.blocks.length}.${Boolean(view.working)}.${Boolean(
          view.gate
        )}`}
      >
        <ClaudeSession
          view={view}
          now={clock.timeOf(item.id, item.session)}
          label={`demo-${item.id}`}
          onAnswer={(option) => clock.answer(item.id, option)}
        />
      </TerminalScreen>
    );
  }
  return (
    <TerminalScreen
      label={`zsh in ${item.branch}`}
      version={String(zsh.history.length)}
      onClick={() => {
        if (!window.getSelection()?.toString()) {
          document.getElementById(ZSH_INPUT)?.focus();
        }
      }}
    >
      <ZshSession
        history={zsh.history}
        branch={item.branch}
        onRun={zsh.run}
        inputId={ZSH_INPUT}
      />
    </TerminalScreen>
  );
}

function PlayControl({ clock }: { clock: Clock }) {
  const Icon = clock.done ? RotateCcw : clock.playing ? Pause : Play;
  const label = clock.done
    ? 'Replay the demo'
    : clock.playing
    ? 'Pause the demo'
    : 'Play the demo';
  return (
    <button
      type="button"
      onClick={clock.done ? clock.replay : clock.togglePlaying}
      aria-label={label}
      className="hover:bg-fd-accent hover:text-fd-foreground focus-visible:ring-fd-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

export function DesktopDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const clock = useDemoClock(ref);
  const tabs = useTabs();
  const zsh = useZsh();
  const views = viewsAt(clock);
  const statusOf = (item: DemoItem) => {
    const view = views[item.id];
    return view
      ? { agent: view.state, ci: view.ci, unresolved: view.unresolved }
      : {};
  };
  const running = Object.values(views).filter(
    (v) => v?.state === 'working'
  ).length;
  const item = tabs.active ? itemOf(tabs.active) : null;
  const view = item ? views[item.id] : undefined;

  return (
    <figure ref={ref} className={className}>
      <div
        role="group"
        aria-label="Interactive mock of n10 Desktop"
        className="n10-frame bg-fd-card relative flex flex-col overflow-hidden rounded-xl text-left"
      >
        <TitleBar />
        <div className="flex h-[26rem] sm:h-[32rem]">
          <DemoSidebar
            statusOf={statusOf}
            active={tabs.active}
            onOpen={tabs.openItem}
          />
          <div className="bg-fd-background flex min-w-0 flex-1 flex-col">
            <DemoTabs
              open={tabs.open}
              active={tabs.active}
              onSelect={tabs.select}
              onClose={tabs.close}
            />
            {item ? (
              <div
                role="tabpanel"
                id={PANEL_ID}
                aria-labelledby={tabId(item.id)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <PanelHeader
                  item={item}
                  ci={view?.ci}
                  unresolved={view?.unresolved}
                />
                <Screen
                  key={item.id}
                  item={item}
                  view={view}
                  clock={clock}
                  zsh={zsh}
                />
              </div>
            ) : (
              <p className="text-fd-muted-foreground m-auto px-6 text-center text-sm">
                Pick a worktree or pull request from the sidebar.
              </p>
            )}
          </div>
        </div>
        <StatusBar running={running} />
      </div>
      <figcaption className="text-fd-muted-foreground mt-3 flex items-center justify-center gap-2 text-sm">
        <span className="text-pretty">
          Scripted: no agent runs and nothing leaves the page. Open rows, switch
          tabs, answer dark-mode when it asks, type in the zsh.
        </span>
        <PlayControl clock={clock} />
      </figcaption>
      <p className="sr-only" aria-live="polite">
        {clock.said}
      </p>
    </figure>
  );
}
