import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { N10HostApi } from './contract.js';

/**
 * Which service each bridge method reaches, asserted rather than
 * assumed.
 *
 * `createHostApi` is one long object of one-line delegations, and the
 * compiler is happy as long as the signatures line up — so
 * `listWorktrees: () => worktrees.listBranches()` type-checks
 * perfectly and returns the wrong list forever. Nothing else in the
 * suite would notice: the service tests pass, the preload test only
 * proves the *channel* is right, and the renderer would simply show
 * branches where worktrees belong.
 *
 * The table below is the wiring, written down. Each row says which
 * service function a method must call, and the arguments must arrive
 * untouched and in order.
 */

const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);

/** Record every export of a service module as `module.fn`. */
function recorder(moduleName: string, names: string[]) {
  return Object.fromEntries(
    names.map((fn) => [
      fn,
      (...args: unknown[]) => {
        calls.push({ fn: `${moduleName}.${fn}`, args });
        return Promise.resolve(`${moduleName}.${fn}`);
      },
    ])
  );
}

vi.mock('./services/repo.js', () =>
  recorder('repo', [
    'openRepo',
    'getRepo',
    'listRecentRepos',
    'forgetRecentRepo',
  ])
);
vi.mock('./services/settings.js', () =>
  recorder('settings', ['getSettingsView', 'updateSettingsFromView'])
);
vi.mock('./services/sidebar.js', () =>
  recorder('sidebar', ['getSidebarSnapshot', 'getSyncState', 'refreshRemote'])
);
vi.mock('./services/worktrees.js', () =>
  recorder('worktrees', [
    'listWorktrees',
    'listBranches',
    'listAllBranches',
    'createWorktree',
    'removeWorktree',
    'canRemoveBranch',
    'openInEditor',
    'getWorktreeDiffText',
  ])
);
vi.mock('./services/reviews.js', () =>
  recorder('reviews', [
    'fetchPullRequests',
    'fetchCommentThreads',
    'replyToThread',
    'setThreadResolved',
    'fetchPrDescription',
    'submitReviewVerdict',
    'getReviewViewer',
    'getDiffText',
    'getFileDiffText',
  ])
);
vi.mock('./services/sessions.js', () =>
  recorder('sessions', [
    'launchAgent',
    'launchReviewAgent',
    'listAgentOptions',
    'getSessionLaunchContext',
    'checkoutPlan',
    'listSessions',
    'getSessionActivity',
    'markSessionSeen',
    'getSessionBuffer',
    'writeSession',
    'resizeSession',
    'killSession',
    'reconnectSession',
  ])
);
vi.mock('./services/terminals.js', () =>
  recorder('terminals', ['launchTerminal', 'listTerminals', 'killTerminal'])
);
vi.mock('./services/foreign-sessions.js', () =>
  recorder('foreignSessions', ['listForeignSessions'])
);
vi.mock('./services/comment-images.js', () =>
  recorder('commentImages', ['fetchCommentImage'])
);
vi.mock('./services/clipboard-image.js', () =>
  recorder('clipboardImage', ['saveClipboardImage'])
);
vi.mock('./services/drafts.js', () =>
  recorder('drafts', [
    'listDraftComments',
    'updateDraftComment',
    'deleteDraftComment',
    'postDraftComments',
  ])
);
vi.mock('./services/babysit.js', () =>
  recorder('babysit', ['startBabysit', 'stopBabysit'])
);
vi.mock('./services/desktop-prefs.js', () =>
  recorder('prefs', ['loadDesktopPrefs', 'saveDesktopPrefs'])
);
vi.mock('./services/machines.js', () =>
  recorder('machines', [
    'listMachines',
    'getAcceptingStatus',
    'setAccepting',
    'regeneratePairingUrl',
    'previewPairing',
    'confirmPairing',
    'renameMachine',
    'revokeMachine',
    'forgetMachine',
  ])
);
vi.mock('./services/inbound-mail.js', () =>
  recorder('inboundMail', ['dismissInboundMail'])
);

const { createHostApi } = await import('./register-handlers.js');

let api: N10HostApi;

beforeEach(() => {
  calls.length = 0;
  api = createHostApi();
});

/** method → the service call it must make, given these arguments. */
const WIRING: [keyof N10HostApi, unknown[], string][] = [
  ['openRepo', ['/repo'], 'repo.openRepo'],
  ['getRepo', [], 'repo.getRepo'],
  ['listRecentRepos', [], 'repo.listRecentRepos'],
  ['forgetRecent', ['/repo'], 'repo.forgetRecentRepo'],

  ['getSettingsView', [], 'settings.getSettingsView'],
  [
    'updateSettingsField',
    [{ label: 'Editor', key: 'editor' }, 'vim'],
    'settings.updateSettingsFromView',
  ],

  ['getSidebarModel', [], 'sidebar.getSidebarSnapshot'],
  ['getSyncState', [], 'sidebar.getSyncState'],
  ['refreshRemote', [], 'sidebar.refreshRemote'],

  ['listWorktrees', [], 'worktrees.listWorktrees'],
  ['listBranches', [], 'worktrees.listBranches'],
  ['listAllBranches', [], 'worktrees.listAllBranches'],
  ['createWorktree', ['feature'], 'worktrees.createWorktree'],
  ['removeWorktree', ['feature', true], 'worktrees.removeWorktree'],
  ['canRemoveBranch', ['feature'], 'worktrees.canRemoveBranch'],
  ['openInEditor', ['feature'], 'worktrees.openInEditor'],

  ['fetchPullRequests', [], 'reviews.fetchPullRequests'],
  ['fetchCommentThreads', [7], 'reviews.fetchCommentThreads'],
  ['fetchPrDescription', [7], 'reviews.fetchPrDescription'],
  [
    'replyToThread',
    [{ prId: 7, thread: { id: 't' }, body: 'hi' }],
    'reviews.replyToThread',
  ],
  [
    'setThreadResolved',
    [{ prId: 7, thread: { id: 't' }, resolved: true }],
    'reviews.setThreadResolved',
  ],
  ['submitReviewVerdict', [7, 'approve'], 'reviews.submitReviewVerdict'],
  ['getReviewViewer', [], 'reviews.getReviewViewer'],
  ['fetchDiffText', ['feature', 'main'], 'reviews.getDiffText'],
  ['fetchFileDiffText', ['feature', 'main', 'a.ts'], 'reviews.getFileDiffText'],
  [
    'fetchWorktreeDiffText',
    ['feature', 'main'],
    'worktrees.getWorktreeDiffText',
  ],

  ['fetchCommentImage', ['https://x/y.png'], 'commentImages.fetchCommentImage'],
  [
    'saveClipboardImage',
    [new Uint8Array([1, 2]), 'image/png'],
    'clipboardImage.saveClipboardImage',
  ],

  ['listDraftComments', [7], 'drafts.listDraftComments'],
  ['updateDraftComment', [7, 'id', { body: 'x' }], 'drafts.updateDraftComment'],
  ['deleteDraftComment', [7, 'id'], 'drafts.deleteDraftComment'],
  ['postDraftComments', [{ prId: 7 }], 'drafts.postDraftComments'],

  ['launchAgent', [{ branch: 'b' }], 'sessions.launchAgent'],
  ['launchReviewAgent', [{ pr: {} }], 'sessions.launchReviewAgent'],
  ['listAgentOptions', [], 'sessions.listAgentOptions'],
  ['getSessionLaunchContext', ['feature'], 'sessions.getSessionLaunchContext'],
  [
    'checkoutPlan',
    [{ pr: {}, prompt: 'p', mode: 'inject' }],
    'sessions.checkoutPlan',
  ],
  ['listSessions', [], 'sessions.listSessions'],
  ['listForeignSessions', [], 'foreignSessions.listForeignSessions'],
  ['getSessionActivity', [], 'sessions.getSessionActivity'],
  ['markSessionSeen', ['b'], 'sessions.markSessionSeen'],
  ['getSessionBuffer', ['b'], 'sessions.getSessionBuffer'],
  ['writeSession', ['b', 'ls\n'], 'sessions.writeSession'],
  ['resizeSession', ['b', 120, 40], 'sessions.resizeSession'],
  ['killSession', ['b'], 'sessions.killSession'],
  ['reconnectSession', ['b'], 'sessions.reconnectSession'],

  [
    'launchTerminal',
    [{ kind: 'shell', cwd: '/x' }],
    'terminals.launchTerminal',
  ],
  ['listTerminals', [], 'terminals.listTerminals'],
  ['killTerminal', ['n10-shell'], 'terminals.killTerminal'],

  ['getDesktopPrefs', [], 'prefs.loadDesktopPrefs'],

  ['startBabysit', [7], 'babysit.startBabysit'],
  ['stopBabysit', [7], 'babysit.stopBabysit'],

  ['listMachines', [], 'machines.listMachines'],
  ['getAcceptingStatus', [], 'machines.getAcceptingStatus'],
  ['setAccepting', [true], 'machines.setAccepting'],
  ['regeneratePairingUrl', [], 'machines.regeneratePairingUrl'],
  ['previewPairing', ['http://host/pair#token=x'], 'machines.previewPairing'],
  [
    'confirmPairing',
    ['http://host/pair#token=x', true],
    'machines.confirmPairing',
  ],
  ['renameMachine', ['bbbbbbbbbbbbbbbb', 'workbox'], 'machines.renameMachine'],
  ['revokeMachine', ['bbbbbbbbbbbbbbbb'], 'machines.revokeMachine'],
  ['forgetMachine', ['bbbbbbbbbbbbbbbb'], 'machines.forgetMachine'],
  ['dismissInboundMail', ['env-1'], 'inboundMail.dismissInboundMail'],
];

describe('host API wiring', () => {
  it.each(WIRING)('%s reaches %s', async (method, args, expected) => {
    // The table is heterogeneous by construction — each row has its own
    // signature — so the call is made through the widest function type
    // rather than through `any`, which would also erase the await.
    await (api[method] as (...a: unknown[]) => unknown)(...args);
    expect(calls.map((c) => c.fn)).toEqual([expected]);
    expect(calls[0].args).toEqual(args);
  });

  it('covers every method that delegates to a service', () => {
    // Guards the table itself: a method added to the contract without a
    // row here would otherwise be silently unwired and untested.
    const notDelegating = new Set([
      'getVersion', // built inline from process.versions
      'selectRepoDirectory', // native dialog, injected by main.ts
      'selectFolder', // the same dialog, any folder
      'openExternal',
      'showContextMenu',
      'showAppMenu',
      'showAbout',
      'setDesktopPrefs', // also notifies main.ts; covered separately
      'onSessionData',
      'onSessionExit',
      'onLaunchStep',
      'onMenuCommand',
      'onBabysitChanged',
      'onSyncNotice',
      'onRemoteUpdated',
      'onDiscoveryChanged',
      'onMachinesChanged',
    ]);
    const covered = new Set(WIRING.map(([m]) => m));
    const missing = Object.keys(api).filter(
      (m) => !covered.has(m as keyof N10HostApi) && !notDelegating.has(m)
    );
    expect(missing).toEqual([]);
  });

  it('reports the running versions rather than a service call', () => {
    // getVersion is the one method that answers from the process
    // itself; it must not start delegating by accident.
    return api.getVersion().then((v) => {
      expect(v.node).toBe(process.versions.node);
      expect(calls).toEqual([]);
    });
  });
});
