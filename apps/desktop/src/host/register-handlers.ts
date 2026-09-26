import { realpathSync } from 'node:fs';
import type {
  ContextMenuItem,
  N10HostApi,
  ReplyRequest,
  ResolveRequest,
} from './contract.js';
import { IPC } from './contract.js';
import * as repo from './services/repo.js';
import * as prefs from './services/desktop-prefs.js';
import * as settings from './services/settings.js';
import * as sidebar from './services/sidebar.js';
import * as worktrees from './services/worktrees.js';
import * as reviews from './services/reviews.js';
import * as sessions from './services/sessions.js';
import * as foreignSessions from './services/foreign-sessions.js';
import * as terminals from './services/terminals.js';
import * as commentImages from './services/comment-images.js';
import * as clipboardImage from './services/clipboard-image.js';
import * as drafts from './services/drafts.js';
import * as babysit from './services/babysit.js';
import * as machines from './services/machines.js';
import * as inboundMail from './services/inbound-mail.js';
import { resolvePickedFolder } from './services/terminal-home.js';

/**
 * The main-process implementation of the host contract. Pure data
 * plumbing — every method delegates to a service module so business
 * logic stays testable without Electron.
 */
export function createHostApi(): N10HostApi {
  return {
    getVersion: () =>
      Promise.resolve({
        app: appVersion,
        electron: process.versions.electron ?? 'unknown',
        node: process.versions.node,
        chrome: process.versions.chrome ?? 'unknown',
      }),

    openRepo: (cwd) => Promise.resolve(repo.openRepo(cwd)),
    getRepo: () => Promise.resolve(repo.getRepo()),
    listRecentRepos: () => Promise.resolve(repo.listRecentRepos()),
    selectRepoDirectory: () => pickFolder('Open repository'),
    selectFolder: () => pickFolder('Open folder'),
    forgetRecent: (cwd) => Promise.resolve(repo.forgetRecentRepo(cwd)),

    getSettingsView: () => Promise.resolve(settings.getSettingsView()),
    updateSettingsField: (ref, value) =>
      Promise.resolve(settings.updateSettingsFromView(ref, value)),

    getSidebarModel: () => sidebar.getSidebarSnapshot(),
    getSyncState: () => Promise.resolve(sidebar.getSyncState()),
    refreshRemote: () => sidebar.refreshRemote(),
    listWorktrees: () => worktrees.listWorktrees(),
    listBranches: () => worktrees.listBranches(),
    listAllBranches: () => worktrees.listAllBranches(),
    createWorktree: (branch) => worktrees.createWorktree(branch),
    removeWorktree: (branch, force) => worktrees.removeWorktree(branch, force),
    canRemoveBranch: (branch) => worktrees.canRemoveBranch(branch),
    openInEditor: (branch) => worktrees.openInEditor(branch),

    fetchPullRequests: () => reviews.fetchPullRequests(),
    fetchCommentThreads: (prId) => reviews.fetchCommentThreads(prId),
    replyToThread: (req: ReplyRequest) => reviews.replyToThread(req),
    setThreadResolved: (req: ResolveRequest) => reviews.setThreadResolved(req),
    fetchPrDescription: (prId) => reviews.fetchPrDescription(prId),
    submitReviewVerdict: (prId, verdict) =>
      reviews.submitReviewVerdict(prId, verdict),
    getReviewViewer: () => Promise.resolve(reviews.getReviewViewer()),
    fetchCommentImage: (url) => commentImages.fetchCommentImage(url),
    listDraftComments: (prId) =>
      Promise.resolve(drafts.listDraftComments(prId)),
    updateDraftComment: (prId, id, patch) =>
      Promise.resolve(drafts.updateDraftComment(prId, id, patch)),
    deleteDraftComment: (prId, id) =>
      Promise.resolve(drafts.deleteDraftComment(prId, id)),
    postDraftComments: (req) => drafts.postDraftComments(req),

    launchAgent: (req) => sessions.launchAgent(req),
    launchReviewAgent: (req) => sessions.launchReviewAgent(req),
    getSessionLaunchContext: (branch) =>
      Promise.resolve(sessions.getSessionLaunchContext(branch)),
    listAgentOptions: () => Promise.resolve(sessions.listAgentOptions()),
    checkoutPlan: (req) => sessions.checkoutPlan(req),
    listSessions: () => Promise.resolve(sessions.listSessions()),
    listForeignSessions: () =>
      Promise.resolve(foreignSessions.listForeignSessions()),
    getSessionActivity: () => Promise.resolve(sessions.getSessionActivity()),
    markSessionSeen: (name) => Promise.resolve(sessions.markSessionSeen(name)),
    getSessionBuffer: (name) =>
      Promise.resolve(sessions.getSessionBuffer(name)),
    writeSession: (name, data) =>
      Promise.resolve(sessions.writeSession(name, data)),
    resizeSession: (name, cols, rows) =>
      Promise.resolve(sessions.resizeSession(name, cols, rows)),
    killSession: (name) => Promise.resolve(sessions.killSession(name)),
    reconnectSession: (name) =>
      Promise.resolve(sessions.reconnectSession(name)),
    saveClipboardImage: (data, mimeType) =>
      Promise.resolve(clipboardImage.saveClipboardImage(data, mimeType)),
    launchTerminal: (req) => terminals.launchTerminal(req),
    listTerminals: () => Promise.resolve(terminals.listTerminals()),
    killTerminal: (name) => Promise.resolve(terminals.killTerminal(name)),
    onSessionData: () => {
      // Events are pushed via setSessionBroadcaster; the preload side
      // subscribes directly to ipcRenderer events. Nothing to do here.
      return () => undefined;
    },
    onSessionExit: () => () => undefined,
    onLaunchStep: () => () => undefined,

    fetchDiffText: (sourceBranch, targetBranch) =>
      reviews.getDiffText(sourceBranch, targetBranch),
    fetchWorktreeDiffText: (branch, targetBranch) =>
      worktrees.getWorktreeDiffText(branch, targetBranch),
    fetchFileDiffText: (sourceBranch, targetBranch, file) =>
      reviews.getFileDiffText(sourceBranch, targetBranch, file),

    openExternal: (url) => externalOpener(url),
    showContextMenu: (items) => contextMenu(items),
    showAppMenu: () => appMenuPopup(),
    onMenuCommand: () => () => undefined,
    onSyncNotice: () => () => undefined,
    onRemoteUpdated: () => () => undefined,
    onDiscoveryChanged: () => () => undefined,
    getDesktopPrefs: () => Promise.resolve(prefs.loadDesktopPrefs()),
    setDesktopPrefs: (patch) => {
      const next = prefs.saveDesktopPrefs(patch);
      prefsChanged(next);
      return Promise.resolve(next);
    },
    showAbout: () => aboutBox(),

    startBabysit: (prId) => babysit.startBabysit(prId),
    stopBabysit: (prId) => Promise.resolve(babysit.stopBabysit(prId)),
    onBabysitChanged: () => () => undefined,

    listMachines: () => machines.listMachines(),
    getBeamStatus: () => machines.getBeamStatus(),
    onBeamStatusChanged: () => () => undefined,
    setMachineAlias: (peerId, alias) => machines.setMachineAlias(peerId, alias),
    setMachineGrant: (peerId, grant) => machines.setMachineGrant(peerId, grant),
    runCeremony: (request) => machines.runCeremony(request),
    cancelCeremony: () => machines.cancelCeremony(),
    resetFleet: () => machines.resetFleet(),
    onCeremonyProgress: () => () => undefined,
    onDirectoryPublished: () => () => undefined,
    dismissInboundMail: (id) => inboundMail.dismissInboundMail(id),
    onMachinesChanged: () => () => undefined,
  };
}

/** Minimal structural subset of Electron's ipcMain we rely on. */
export interface IpcRegistrar {
  handle(channel: string, fn: (...args: unknown[]) => unknown): void;
}

// `never[]` rather than `any[]`: parameters are contravariant, so every
// concrete host method is assignable to this while the type still says
// nothing may be passed blindly. `any[]` would have made the cast below
// silently accept a mismatched signature.
type HostMethod = (...args: never[]) => unknown;

// Injected by main.ts (Electron's native dialog / shell). Defaults are
// no-ops so tests and non-Electron contexts never touch those modules.
let folderPicker: (title: string) => Promise<string | null> = async () => null;
let externalOpener: (url: string) => Promise<void> = async () => undefined;
let contextMenu: (
  items: ContextMenuItem[]
) => Promise<string | null> = async () => null;
let appMenuPopup: () => Promise<void> = async () => undefined;
let aboutBox: () => Promise<void> = async () => undefined;
let prefsChanged: (next: prefs.DesktopPrefsLike) => void = () => undefined;
let appVersion = 'dev';

export function setFolderPicker(
  fn: (title: string) => Promise<string | null>
): void {
  folderPicker = fn;
}

/** The native picker, with its result canonicalized — see
 *  `resolvePickedFolder`. A symlink the user picks otherwise compares
 *  unequal to the already-open repository's root (which `getRepoRoot()`
 *  resolves via `git rev-parse`), and reads as a second repository. */
async function pickFolder(title: string): Promise<string | null> {
  const picked = await folderPicker(title);
  return picked === null ? null : resolvePickedFolder(picked, realpathSync);
}

export function setExternalOpener(fn: (url: string) => Promise<void>): void {
  externalOpener = fn;
}

export function setShellGlue(glue: {
  contextMenu: (items: ContextMenuItem[]) => Promise<string | null>;
  appMenuPopup: () => Promise<void>;
  aboutBox: () => Promise<void>;
  prefsChanged: (next: prefs.DesktopPrefsLike) => void;
  appVersion: string;
}): void {
  appVersion = glue.appVersion;
  contextMenu = glue.contextMenu;
  appMenuPopup = glue.appMenuPopup;
  aboutBox = glue.aboutBox;
  prefsChanged = glue.prefsChanged;
}

/**
 * Register one ipcMain handler per contract channel. Handlers are
 * wrapped so rejections cross the IPC boundary with their message
 * intact (Electron otherwise strips custom error fields).
 */
export function registerHostHandlers(
  register: IpcRegistrar,
  api: N10HostApi = createHostApi()
): void {
  const handlers: Record<string, HostMethod | undefined> = {
    [IPC.getVersion]: api.getVersion as HostMethod,
    [IPC.openRepo]: api.openRepo as HostMethod,
    [IPC.getRepo]: api.getRepo as HostMethod,
    [IPC.listRecentRepos]: api.listRecentRepos as HostMethod,
    [IPC.selectRepoDirectory]: api.selectRepoDirectory as HostMethod,
    [IPC.selectFolder]: api.selectFolder as HostMethod,
    [IPC.forgetRecent]: api.forgetRecent as HostMethod,
    [IPC.getSettingsView]: api.getSettingsView as HostMethod,
    [IPC.updateSettingsField]: api.updateSettingsField as HostMethod,
    [IPC.getSidebarModel]: api.getSidebarModel as HostMethod,
    [IPC.getSyncState]: api.getSyncState as HostMethod,
    [IPC.refreshRemote]: api.refreshRemote as HostMethod,
    [IPC.listWorktrees]: api.listWorktrees as HostMethod,
    [IPC.listBranches]: api.listBranches as HostMethod,
    [IPC.listAllBranches]: api.listAllBranches as HostMethod,
    [IPC.createWorktree]: api.createWorktree as HostMethod,
    [IPC.removeWorktree]: api.removeWorktree as HostMethod,
    [IPC.canRemoveBranch]: api.canRemoveBranch as HostMethod,
    [IPC.openInEditor]: api.openInEditor as HostMethod,
    [IPC.launchAgent]: api.launchAgent as HostMethod,
    [IPC.listSessions]: api.listSessions as HostMethod,
    [IPC.listForeignSessions]: api.listForeignSessions as HostMethod,
    [IPC.getSessionActivity]: api.getSessionActivity as HostMethod,
    [IPC.markSessionSeen]: api.markSessionSeen as HostMethod,
    [IPC.getSessionBuffer]: api.getSessionBuffer as HostMethod,
    [IPC.writeSession]: api.writeSession as HostMethod,
    [IPC.resizeSession]: api.resizeSession as HostMethod,
    [IPC.killSession]: api.killSession as HostMethod,
    [IPC.reconnectSession]: api.reconnectSession as HostMethod,
    [IPC.saveClipboardImage]: api.saveClipboardImage as HostMethod,
    [IPC.launchTerminal]: api.launchTerminal as HostMethod,
    [IPC.listTerminals]: api.listTerminals as HostMethod,
    [IPC.killTerminal]: api.killTerminal as HostMethod,
    [IPC.fetchPullRequests]: api.fetchPullRequests as HostMethod,
    [IPC.fetchCommentThreads]: api.fetchCommentThreads as HostMethod,
    [IPC.replyToThread]: api.replyToThread as HostMethod,
    [IPC.setThreadResolved]: api.setThreadResolved as HostMethod,
    [IPC.fetchPrDescription]: api.fetchPrDescription as HostMethod,
    [IPC.submitReviewVerdict]: api.submitReviewVerdict as HostMethod,
    [IPC.getReviewViewer]: api.getReviewViewer as HostMethod,
    [IPC.fetchCommentImage]: api.fetchCommentImage as HostMethod,
    [IPC.listDraftComments]: api.listDraftComments as HostMethod,
    [IPC.updateDraftComment]: api.updateDraftComment as HostMethod,
    [IPC.deleteDraftComment]: api.deleteDraftComment as HostMethod,
    [IPC.postDraftComments]: api.postDraftComments as HostMethod,
    [IPC.launchReviewAgent]: api.launchReviewAgent as HostMethod,
    [IPC.getSessionLaunchContext]: api.getSessionLaunchContext as HostMethod,
    [IPC.listAgentOptions]: api.listAgentOptions as HostMethod,
    [IPC.checkoutPlan]: api.checkoutPlan as HostMethod,
    [IPC.fetchDiffText]: api.fetchDiffText as HostMethod,
    [IPC.fetchWorktreeDiffText]: api.fetchWorktreeDiffText as HostMethod,
    [IPC.fetchFileDiffText]: api.fetchFileDiffText as HostMethod,
    [IPC.openExternal]: api.openExternal as HostMethod,
    [IPC.showContextMenu]: api.showContextMenu as HostMethod,
    [IPC.showAppMenu]: api.showAppMenu as HostMethod,
    [IPC.getDesktopPrefs]: api.getDesktopPrefs as HostMethod,
    [IPC.setDesktopPrefs]: api.setDesktopPrefs as HostMethod,
    [IPC.showAbout]: api.showAbout as HostMethod,
    [IPC.startBabysit]: api.startBabysit as HostMethod,
    [IPC.stopBabysit]: api.stopBabysit as HostMethod,
    [IPC.listMachines]: api.listMachines as HostMethod,
    [IPC.getBeamStatus]: api.getBeamStatus as HostMethod,
    [IPC.setMachineAlias]: api.setMachineAlias as HostMethod,
    [IPC.setMachineGrant]: api.setMachineGrant as HostMethod,
    [IPC.runCeremony]: api.runCeremony as HostMethod,
    [IPC.cancelCeremony]: api.cancelCeremony as HostMethod,
    [IPC.resetFleet]: api.resetFleet as HostMethod,
    [IPC.dismissInboundMail]: api.dismissInboundMail as HostMethod,
  };

  for (const [channel, fn] of Object.entries(handlers)) {
    if (!fn) throw new Error(`No host implementation for ${channel}`);
    // Electron's ipcMain.handle passes the IpcMainInvokeEvent as the
    // first listener arg; the contract methods only want the payload.
    register.handle(channel, async (event, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(message);
      }
    });
  }
}
