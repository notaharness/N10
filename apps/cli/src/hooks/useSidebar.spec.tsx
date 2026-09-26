// Renders SidebarProvider for real (ink-testing-library) because what
// is under test is a React property: *when* the selection anchor is
// resolved against the items list. The pure resolvers it is built from
// are covered in libs/app-core/src/lib/context/SidebarContext.spec.ts;
// neither they nor a hand-rolled render loop can say anything about a
// callback that outlives the render that created it.
//
// SidebarProvider reads its data through useSessionData/useConfig, and
// the real SessionProvider drags live git in, so both are stubbed at
// their module boundary. The paths reach into app-core because
// SidebarContext imports its siblings relatively — mocking the barrel
// would not intercept those.

import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import type { SidebarContextValue } from '@n10/app-core';
import type { AgentSession } from '@n10/core';
import { SidebarProvider, useSidebar } from '@n10/app-core';
import { getItemKey } from '@n10/core';

// Identities have to be stable across renders: SidebarProvider memoises
// `items` on these fields, and a fresh Map every render would make the
// list look changed on every pass. Only the session lists are swapped.
const sessionData = vi.hoisted(() => ({
  sessions: [] as { name: string; running: boolean }[],
  sortedSessions: [] as { name: string; running: boolean }[],
  orphanPrs: [],
  categorizedReviews: {
    needsReview: [],
    waitingForAuthor: [],
    approvedByYou: [],
  },
  sessionPrMap: new Map<string, never>(),
  mergedBranches: new Set<string>(),
  conflictCounts: new Map<string, number>(),
}));

vi.mock('../../../../libs/app-core/src/lib/context/SessionContext.js', () => ({
  useSessionData: () => sessionData,
}));

vi.mock(
  '../../../../libs/app-core/src/lib/context/ConfigContext.js',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useConfig: () => ({ vcsConfigured: false }),
  })
);

function sessions(...names: string[]): AgentSession[] {
  return names.map((name) => ({ name, running: false }));
}

function selectedKeyOf(sidebar: SidebarContextValue): string {
  const item = sidebar.selectedItem;
  return item ? getItemKey(item) : 'none';
}

/**
 * Mounts the provider and keeps every context value it has ever
 * published, so a test can call a handler from an *earlier* render —
 * which is what every caller that awaits git work before selecting
 * ends up doing.
 */
function mountSidebar(names: string[]) {
  sessionData.sessions = sessionData.sortedSessions = sessions(...names);
  const renders: SidebarContextValue[] = [];

  function Probe() {
    const sidebar = useSidebar();
    renders.push(sidebar);
    return <Text>{`${sidebar.selectedIndex}:${selectedKeyOf(sidebar)}`}</Text>;
  }

  // A fresh element every time: React bails out of a re-render when
  // handed the identical element object, and the whole point of
  // `commit` is to get the provider to look at the list again.
  const tree = () => (
    <SidebarProvider>
      <Probe />
    </SidebarProvider>
  );
  const inst = render(tree());

  return {
    latest: () => renders[renders.length - 1]!,
    /** Publish a new sessions list, the way a sidebar refresh does. */
    commit: async (...next: string[]) => {
      sessionData.sessions = sessionData.sortedSessions = sessions(...next);
      inst.rerender(tree());
      await flush();
    },
    frame: () => inst.lastFrame(),
    unmount: () => inst.unmount(),
  };
}

/**
 * Let React's scheduler drain. Updates dispatched from outside a React
 * event (which is every one of these — the app's callers dispatch from
 * awaited git work) are scheduled, not applied inline.
 */
async function flush() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('sidebar selection', () => {
  it('resolves a selectByKey against the committed list, not the one its render closed over', async () => {
    // The branch picker, the plan checkout and the confirm dialogs all
    // capture `ctx.sidebar` and then await git work before calling
    // selectByKey; a sidebar refresh commits a re-sorted list in the
    // meantime. The handler they are holding belongs to the render
    // that saw the *old* list, so resolving the key inside that
    // callback resolves it against a list nobody is looking at.
    const ui = mountSidebar(['a', 'b', 'c']);
    await flush();
    expect(ui.frame()).toBe('0:session:a');

    // Captured while ['a', 'b', 'c'] is on screen, where 'c' is row 2.
    const heldSelectByKey = ui.latest().selectByKey;

    // Sessions re-sort on activity; 'c' is now the first row.
    await ui.commit('c', 'a', 'b');
    expect(ui.frame()).toBe('1:session:a');

    heldSelectByKey('session:c');
    await flush();

    expect(ui.frame()).toBe('0:session:c');
    ui.unmount();
  });

  it('leaves the cursor put until a key that is not on the list yet arrives', async () => {
    // The key the branch picker actually sends: a session created
    // moments ago that the sidebar has not picked up. It must not yank
    // the cursor to the top of the list while it waits.
    const ui = mountSidebar(['a', 'b']);
    await flush();

    ui.latest().moveSelection(1);
    await flush();
    expect(ui.frame()).toBe('1:session:b');

    ui.latest().selectByKey('session:brand-new');
    await flush();
    expect(ui.frame()).toBe('1:session:b');

    await ui.commit('a', 'b', 'brand-new');
    expect(ui.frame()).toBe('2:session:brand-new');
    ui.unmount();
  });

  it('lands on the row that replaced one deleted after it was selected', async () => {
    // The delete fallback needs the index the selection last resolved
    // to, so every render has to write that index back — selecting a
    // row and deleting it is the only thing that reads it.
    const ui = mountSidebar(['a', 'b', 'c']);
    await flush();

    ui.latest().selectByKey('session:c');
    await flush();
    expect(ui.frame()).toBe('2:session:c');

    await ui.commit('a', 'b');
    expect(ui.frame()).toBe('1:session:b');
    ui.unmount();
  });
});
