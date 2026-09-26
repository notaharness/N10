import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand, ThemePreference } from './contract.js';

/**
 * Native application menu. Pure template builder so it is testable
 * without Electron: `send` is invoked with a MenuCommand, main.ts
 * forwards it to the focused renderer over IPC.
 *
 * macOS shows this in the system menu bar; Linux/Windows show it as
 * the window menu bar when the native frame is enabled, and as a
 * popup from the title bar's menu button otherwise.
 *
 * It lives in host/ because the web demo (`renderer/demo`) builds the
 * same template for its title bar menu, so it takes nothing from
 * Electron but types.
 */
export interface MenuEnv {
  platform: NodeJS.Platform;
  isDev: boolean;
  theme: ThemePreference;
  appVersion: string;
}

export function buildMenuTemplate(
  env: MenuEnv,
  send: (command: MenuCommand, arg?: string) => void
): MenuItemConstructorOptions[] {
  const isMac = env.platform === 'darwin';
  const mod = isMac ? 'Cmd' : 'Ctrl';

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: 'n10',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: 'Settings…',
              accelerator: 'Cmd+,',
              click: () => send('open-settings'),
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : [];

  const file: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      {
        label: 'Open Repository…',
        accelerator: `${mod}+O`,
        click: () => send('open-repo'),
      },
      {
        label: 'Switch Repository…',
        accelerator: `${mod}+Shift+O`,
        click: () => send('switch-repo'),
      },
      { type: 'separator' },
      {
        label: 'New Worktree…',
        accelerator: `${mod}+N`,
        click: () => send('new-worktree'),
      },
      {
        label: 'New Terminal…',
        accelerator: `${mod}+Shift+T`,
        click: () => send('new-terminal'),
      },
      { type: 'separator' },
      ...(isMac
        ? []
        : [
            {
              label: 'Settings…',
              accelerator: 'Ctrl+,',
              click: () => send('open-settings'),
            } satisfies MenuItemConstructorOptions,
            { type: 'separator' } satisfies MenuItemConstructorOptions,
          ]),
      {
        label: 'Close Tab',
        accelerator: `${mod}+W`,
        click: () => send('close-tab'),
      },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: '&Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const themeItem = (
    label: string,
    value: ThemePreference
  ): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: env.theme === value,
    click: () => send('set-theme', value),
  });

  const view: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      {
        label: 'Command Palette…',
        accelerator: `${mod}+Shift+P`,
        click: () => send('command-palette'),
      },
      {
        label: 'Toggle Sidebar',
        accelerator: `${mod}+B`,
        click: () => send('toggle-sidebar'),
      },
      { type: 'separator' },
      {
        label: 'Refresh Pull Requests',
        accelerator: `${mod}+R`,
        click: () => send('refresh-remote'),
      },
      { type: 'separator' },
      {
        label: 'Theme',
        submenu: [
          themeItem('System', 'system'),
          themeItem('Light', 'light'),
          themeItem('Dark', 'dark'),
        ],
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(env.isDev
        ? [
            { type: 'separator' } satisfies MenuItemConstructorOptions,
            { role: 'reload' } satisfies MenuItemConstructorOptions,
            { role: 'toggleDevTools' } satisfies MenuItemConstructorOptions,
          ]
        : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '&Window',
    submenu: isMac
      ? [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ]
      : [{ role: 'minimize' }, { role: 'close' }],
  };

  const help: MenuItemConstructorOptions = {
    label: '&Help',
    submenu: [
      {
        label: 'n10 on GitHub',
        click: () => send('open-url', 'https://github.com/notaharness/n10'),
      },
      {
        label: 'Report an Issue',
        click: () =>
          send('open-url', 'https://github.com/notaharness/n10/issues'),
      },
      { type: 'separator' },
      {
        label: 'Keyboard Shortcuts',
        click: () => send('show-shortcuts'),
      },
      ...(isMac
        ? []
        : [
            { type: 'separator' } satisfies MenuItemConstructorOptions,
            {
              label: `About n10 Desktop`,
              click: () => send('about'),
            } satisfies MenuItemConstructorOptions,
          ]),
    ],
  };

  return [...appMenu, file, edit, view, windowMenu, help];
}
