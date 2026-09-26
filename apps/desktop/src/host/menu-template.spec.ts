import { describe, it, expect, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildMenuTemplate } from './menu-template.js';

const env = (platform: NodeJS.Platform) => ({
  platform,
  isDev: false,
  theme: 'system' as const,
  appVersion: '1.0.0',
});

function labels(template: ReturnType<typeof buildMenuTemplate>): string[] {
  return template.map((m) => String(m.label ?? m.role));
}

/** Every clickable item in the template, flattened, by label. */
function clickable(
  template: ReturnType<typeof buildMenuTemplate>
): Map<string, () => void> {
  const out = new Map<string, () => void>();
  const walk = (items: readonly MenuItemConstructorOptions[]) => {
    for (const item of items) {
      if (item.label && typeof item.click === 'function') {
        out.set(String(item.label), item.click as () => void);
      }
      const sub = item.submenu;
      if (Array.isArray(sub)) walk(sub);
    }
  };
  walk(template);
  return out;
}

describe('buildMenuTemplate', () => {
  it('puts the app menu first on macOS only', () => {
    expect(labels(buildMenuTemplate(env('darwin'), vi.fn()))[0]).toBe('n10');
    expect(labels(buildMenuTemplate(env('linux'), vi.fn()))[0]).toBe('&File');
  });

  it('routes clicks to menu commands', () => {
    const send = vi.fn();
    const template = buildMenuTemplate(env('linux'), send);
    const file = template.find((m) => m.label === '&File');
    const open = (
      file?.submenu as { label?: string; click?: () => void }[]
    ).find((i) => i.label === 'Open Repository…');
    open?.click?.();
    expect(send).toHaveBeenCalledWith('open-repo');
  });

  it('reflects the current theme in the radio group', () => {
    const template = buildMenuTemplate(
      { ...env('linux'), theme: 'dark' },
      vi.fn()
    );
    const view = template.find((m) => m.label === '&View');
    const theme = (
      view?.submenu as { label?: string; submenu?: unknown }[]
    ).find((i) => i.label === 'Theme');
    const items = theme?.submenu as { label: string; checked?: boolean }[];
    expect(items.find((i) => i.label === 'Dark')?.checked).toBe(true);
    expect(items.find((i) => i.label === 'Light')?.checked).toBe(false);
  });

  it('only exposes dev tools in dev builds', () => {
    const roles = (t: ReturnType<typeof buildMenuTemplate>) =>
      (t.find((m) => m.label === '&View')?.submenu as { role?: string }[]).map(
        (i) => i.role
      );
    expect(roles(buildMenuTemplate(env('linux'), vi.fn()))).not.toContain(
      'toggleDevTools'
    );
    expect(
      roles(buildMenuTemplate({ ...env('linux'), isDev: true }, vi.fn()))
    ).toContain('toggleDevTools');
  });
});

/**
 * The menu is the only route to several commands (Settings has no
 * renderer keybinding at all), and each item is a one-line `click`
 * that fires a string. A wrong string is silent: the item highlights,
 * the renderer's switch matches nothing, and the command does not
 * happen.
 */
describe('menu commands', () => {
  const EXPECTED: [string, unknown[]][] = [
    ['Open Repository…', ['open-repo']],
    ['Switch Repository…', ['switch-repo']],
    ['New Worktree…', ['new-worktree']],
    ['New Terminal…', ['new-terminal']],
    ['Settings…', ['open-settings']],
    ['Close Tab', ['close-tab']],
    ['Command Palette…', ['command-palette']],
    ['Toggle Sidebar', ['toggle-sidebar']],
    ['Refresh Pull Requests', ['refresh-remote']],
    ['Keyboard Shortcuts', ['show-shortcuts']],
    ['n10 on GitHub', ['open-url', 'https://github.com/notaharness/n10']],
    [
      'Report an Issue',
      ['open-url', 'https://github.com/notaharness/n10/issues'],
    ],
  ];

  it.each(EXPECTED)('%s sends %s', (label, expected) => {
    const send = vi.fn();
    const items = clickable(buildMenuTemplate(env('linux'), send));
    const click = items.get(label);
    expect(click, `no menu item labelled ${label}`).toBeTypeOf('function');
    click?.();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(...(expected as [string, string?]));
  });

  it('sends the chosen theme from each radio item', () => {
    const send = vi.fn();
    const items = clickable(buildMenuTemplate(env('linux'), send));
    for (const [label, value] of [
      ['System', 'system'],
      ['Light', 'light'],
      ['Dark', 'dark'],
    ]) {
      send.mockClear();
      items.get(label)?.();
      expect(send).toHaveBeenCalledWith('set-theme', value);
    }
  });

  it('has no clickable item that sends nothing', () => {
    // A menu entry that looks live and does nothing is worse than one
    // that is absent.
    const send = vi.fn();
    const items = clickable(buildMenuTemplate(env('linux'), send));
    for (const [label, click] of items) {
      send.mockClear();
      click();
      expect(send, `${label} fired no command`).toHaveBeenCalled();
    }
  });

  it('offers the same commands on macOS', () => {
    // The mac template is assembled differently (app menu first, its own
    // Settings entry); the commands behind it must not drift.
    const mac = clickable(buildMenuTemplate(env('darwin'), vi.fn()));
    for (const [label] of EXPECTED) {
      expect([...mac.keys()], `${label} missing on macOS`).toContain(label);
    }
  });
});
