import type { MenuItemConstructorOptions } from 'electron';
import type {
  ContextMenuItem,
  MenuCommand,
  ThemePreference,
} from '../../../host/contract.js';
import { buildMenuTemplate } from '../../../host/menu-template.js';
import { showContextMenu } from './context-menu.js';

/**
 * The title bar's menu button pops the application menu. The page
 * builds the app's own template (Linux, as a release build) and shows
 * it as one flat menu: each top-level menu's commands in order,
 * separated, submenus inlined and OS roles (undo, zoom, quit…) left out
 * because the page has nothing to hand them to.
 */
type Entry = { label: string; run: () => void } | 'separator';

function entries(items: MenuItemConstructorOptions[], prefix = ''): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    if (item.type === 'separator') {
      if (out.length && out.at(-1) !== 'separator') out.push('separator');
      continue;
    }
    const label = `${prefix}${(item.label ?? '').replace('&', '')}`;
    if (Array.isArray(item.submenu)) {
      out.push(...entries(item.submenu, `${label}: `));
    } else if (item.click) {
      const click = item.click;
      out.push({ label, run: () => (click as () => void)() });
    }
  }
  while (out.at(-1) === 'separator') out.pop();
  return out;
}

export async function showAppMenu(
  theme: ThemePreference,
  send: (command: MenuCommand, arg?: string) => void
): Promise<void> {
  const template = buildMenuTemplate(
    { platform: 'linux', isDev: false, theme, appVersion: '1.0.0' },
    send
  );
  const flat = template.flatMap((menu, i) => {
    const inner = Array.isArray(menu.submenu) ? entries(menu.submenu) : [];
    return i > 0 && inner.length ? ['separator' as const, ...inner] : inner;
  });
  const items: ContextMenuItem[] = flat.map((entry, i) =>
    entry === 'separator'
      ? { type: 'separator' }
      : { id: String(i), label: entry.label }
  );
  const picked = await showContextMenu(items);
  const entry = picked === null ? undefined : flat[Number(picked)];
  if (entry && entry !== 'separator') entry.run();
}
