import type { ContextMenuItem } from '../../../host/contract.js';

/**
 * The context menu the host pops for `showContextMenu`. In the app it
 * is the OS's own (`Menu.popup`); in the page it is drawn here, at the
 * pointer, with the desktop's popover tokens. Arrow keys move, Enter
 * picks, Escape or a click elsewhere dismisses with null.
 */
let pointer = { x: 0, y: 0 };

export function trackPointer(): void {
  const remember = (event: MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener('contextmenu', remember, true);
  window.addEventListener('pointerdown', remember, true);
}

const MENU =
  'fixed z-[1000] min-w-44 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none';
const ITEM =
  'flex w-full items-center rounded-sm px-2 py-1.5 text-left outline-none focus:bg-accent focus:text-accent-foreground disabled:opacity-50';

function place(menu: HTMLElement): void {
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(pointer.x, innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(pointer.y, innerHeight - rect.height - 4)}px`;
}

export function showContextMenu(
  items: ContextMenuItem[]
): Promise<string | null> {
  return new Promise((resolve) => {
    const opener = document.activeElement as HTMLElement | null;
    const menu = document.createElement('div');
    menu.className = MENU;
    menu.setAttribute('role', 'menu');
    const buttons: HTMLButtonElement[] = [];
    for (const item of items) {
      if ('type' in item) {
        const rule = document.createElement('div');
        rule.className = '-mx-1 my-1 h-px bg-border';
        rule.setAttribute('role', 'separator');
        menu.append(rule);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${ITEM}${item.danger ? ' text-destructive' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.disabled = item.enabled === false;
      button.addEventListener('click', () => close(item.id));
      buttons.push(button);
      menu.append(button);
    }

    function close(id: string | null) {
      document.removeEventListener('pointerdown', outside, true);
      menu.remove();
      opener?.focus();
      resolve(id);
    }
    function outside(event: PointerEvent) {
      if (!menu.contains(event.target as Node)) close(null);
    }
    menu.addEventListener('keydown', (event) => {
      const enabled = buttons.filter((b) => !b.disabled);
      const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') close(null);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        enabled[(at + step + enabled.length) % enabled.length]?.focus();
      } else return;
      event.preventDefault();
    });

    document.body.append(menu);
    place(menu);
    buttons.find((b) => !b.disabled)?.focus();
    document.addEventListener('pointerdown', outside, true);
  });
}
