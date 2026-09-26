import type {
  PullRequestComments,
  RemoteCommentThread,
} from '../../../host/contract.js';
import { TEAMMATE } from './identity.js';

/**
 * Review threads on the demo's pull requests. The two on #177 are the
 * review it really got, anchored to lines of its final diff.
 */

function thread(
  id: string,
  file: string | null,
  line: number | null,
  body: string,
  minutesAgo: number
): RemoteCommentThread {
  return {
    id,
    file,
    lineStart: line,
    lineEnd: line,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: file !== null,
    ...(file === null
      ? {
          replyKind: 'github-issue-comment' as const,
          replySubjectId: 'PR_kwDOM4x2c86Kx177',
        }
      : {}),
    comments: [
      {
        id: `${id}-1`,
        author: TEAMMATE,
        body,
        createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      },
    ],
  };
}

const TAB_SYNC = thread(
  'PRRT_kwDOM4x2c86Rk1Fq',
  'apps/desktop/src/renderer/lib/tabs/tab-sync.ts',
  77,
  "issue (blocking): the pull request row a switch leaves behind can no longer be opened while the worktree's tab is open\n\n" +
    "Following the worktree ahead of a key that still exists moves the tab's `itemKey` to `branch:other`, but its `id` stays `itemTabId(repo, 'pr:12')`. `openItem` (`tabs-model.ts`, not in this diff) looks up an existing tab by `t.itemKey === itemKey || t.id === id`. So clicking the PR 12 row that the switch left in the sidebar matches the worktree tab by id. It activates the tab showing `other`, and PR 12 never gets a tab of its own.\n\n" +
    "Suggested fix: in `openItem`, match by `itemKey` only. When the derived id is already taken by a tab that has moved on, mint a distinct id. Don't re-id the moved tab, because `EditorArea` keys the pane by `tab.id` and re-iding would remount the terminal. Add a spec case that opens the left-behind row.",
  48
);

const HELD_SESSIONS = thread(
  'PRRT_kwDOM4x2c86Rk2Lw',
  'apps/desktop/src/host/services/worktree-sessions.ts',
  85,
  'suggestion (non-blocking): the "no fork on an ordinary poll" claim doesn\'t hold once a held session outlives its row\n\n' +
    "`known` entries for worktree sessions are never deleted. Say you remove a worktree whose agent ran in this app session. From then on this `every` check fails on every sidebar poll (4 s), and `listOurSessions` runs a synchronous `execFileSync('tmux', ...)` on the Electron main thread for the rest of the app's life.\n\n" +
    "Suggested fix: add `isSessionAlive(name)` to the `heldNames` filter. A dead or removed session can't be running in any worktree, so only live, unmatched sessions trigger the listing.",
  46
);

const GENERAL = thread(
  'IC_kwDOM4x2c87Aq9Xe',
  null,
  null,
  'Nice catch on the switched checkout. CI is red on `branch-switch.test.ts` though; it looks like the banner renders before the sidebar poll lands. Could you take a look?',
  41
);

export function n10Threads(prId: number): Record<number, PullRequestComments> {
  return {
    [prId]: {
      threads: [TAB_SYNC, HELD_SESSIONS],
      generalComments: [GENERAL],
    },
  };
}
