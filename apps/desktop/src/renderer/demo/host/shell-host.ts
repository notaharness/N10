import type { MenuCommandEvent } from '../../../host/contract-events.js';
import type {
  DesktopPrefs,
  N10HostApi,
  RepoInfo,
  SettingsFieldView,
} from '../../../host/contract.js';
import { BEAM_STATUS, machines } from '../data/machines.js';
import { requestedTheme } from '../embed.js';
import { showAppMenu } from '../native/app-menu.js';
import { showContextMenu } from '../native/context-menu.js';
import { pickFolder } from '../native/folder-picker.js';
import { Channel, later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * The window around the repositories: which one is open and the recent
 * list, settings, the OS surfaces (folder picker, context menus, drawn
 * in the page by native/) and the machines of the fleet. Anything that
 * would leave the page (a browser tab, an editor, a passkey) is a
 * no-op.
 */
const info = (cwd: string): RepoInfo => ({
  cwd,
  providerId: 'github',
  vcsConfigured: true,
});

const SETTINGS: SettingsFieldView[] = [
  {
    label: 'Agent',
    key: 'agentId',
    group: 'agent',
    kind: 'select',
    value: 'claude',
    presets: [
      { name: 'Claude Code', value: 'claude' },
      { name: 'Codex', value: 'codex' },
      { name: 'Gemini CLI', value: 'gemini' },
      { name: 'GitHub Copilot', value: 'copilot' },
      { name: 'OpenCode', value: 'opencode' },
    ],
  },
  {
    label: 'Worktree Path',
    key: 'worktreePath',
    group: 'general',
    kind: 'text',
    value: '',
    defaultValue: '.claude/worktrees/{session}',
    description:
      'Template for worktree placement ({session} = sanitized branch). Restart required.',
  },
  {
    label: 'PR poll interval',
    key: 'prPollInterval',
    group: 'sync',
    kind: 'text',
    value: '60',
    description: 'Seconds between pull request refreshes.',
  },
  {
    label: 'Personal access token',
    key: 'token',
    group: 'provider',
    kind: 'text',
    masked: true,
    value: '••••••••',
  },
];

type ShellHost = Pick<
  N10HostApi,
  | 'getVersion'
  | 'openRepo'
  | 'getRepo'
  | 'listRecentRepos'
  | 'selectRepoDirectory'
  | 'selectFolder'
  | 'forgetRecent'
  | 'getSettingsView'
  | 'updateSettingsField'
  | 'openExternal'
  | 'showContextMenu'
  | 'showAppMenu'
  | 'onMenuCommand'
  | 'getDesktopPrefs'
  | 'setDesktopPrefs'
  | 'showAbout'
  | 'listMachines'
  | 'getBeamStatus'
  | 'onBeamStatusChanged'
  | 'setMachineAlias'
  | 'setMachineGrant'
  | 'runCeremony'
  | 'cancelCeremony'
  | 'resetFleet'
  | 'onCeremonyProgress'
  | 'onDirectoryPublished'
  | 'onMachinesChanged'
  | 'dismissInboundMail'
>;

export function createShellHost(state: DemoState): ShellHost {
  let prefs: DesktopPrefs = {
    theme: requestedTheme() ?? 'system',
    nativeFrame: false,
  };
  const never = new Channel<never>();
  const menuCommands = new Channel<MenuCommandEvent>();
  const unavailable = {
    ok: false as const,
    code: 'demo',
    detail: 'Machines need a real install.',
  };
  return {
    getVersion: () =>
      later({ app: '1.0.0', electron: '44.0.0', node: '24.4.0', chrome: '' }),
    openRepo: async (cwd) => {
      await later(null, 250);
      return info(state.open(cwd).cwd);
    },
    getRepo: () => later(info(state.current)),
    listRecentRepos: () =>
      later(
        state.recent.map((cwd, i) => ({
          cwd,
          lastOpenedAt: Date.now() - i * 3_600_000,
          valid: true,
        }))
      ),
    selectRepoDirectory: () => pickFolder('Open a repository'),
    selectFolder: () => pickFolder('Choose a folder'),
    forgetRecent: (cwd) => {
      const at = state.recent.indexOf(cwd);
      if (at >= 0) state.recent.splice(at, 1);
      return later(undefined);
    },
    getSettingsView: () => later(SETTINGS),
    updateSettingsField: () => later(undefined),
    openExternal: () => later(undefined),
    showContextMenu,
    showAppMenu: () =>
      showAppMenu(prefs.theme, (command, arg) =>
        menuCommands.emit({ command, arg })
      ),
    onMenuCommand: menuCommands.subscribe,
    getDesktopPrefs: () => later(prefs),
    setDesktopPrefs: (patch) => {
      prefs = { ...prefs, ...patch };
      return later(prefs);
    },
    showAbout: () => later(undefined),
    listMachines: () => later(machines()),
    getBeamStatus: () => later(BEAM_STATUS),
    onBeamStatusChanged: never.subscribe,
    setMachineAlias: () => later(undefined),
    setMachineGrant: () => later(undefined),
    runCeremony: () => later(unavailable),
    cancelCeremony: () => later(undefined),
    resetFleet: () => later(unavailable),
    onCeremonyProgress: never.subscribe,
    onDirectoryPublished: never.subscribe,
    onMachinesChanged: never.subscribe,
    dismissInboundMail: () => later(undefined),
  };
}
