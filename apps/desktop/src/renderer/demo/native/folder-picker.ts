import { HOME } from '../data/identity.js';

/**
 * The folder picker the host opens for `selectRepoDirectory` and
 * `selectFolder`. In the app it is the OS dialog; in the page it is a
 * modal `<dialog>` over `~/code`, drawn with the desktop's tokens. It
 * resolves to the chosen path, or null when cancelled. Not every folder
 * is a repository, so picking one of those is refused the way the real
 * host refuses it.
 */
const FOLDERS = ['beam', 'dotfiles', 'n10', 'notes', 'plugins'];

const DIALOG =
  'm-auto w-[26rem] rounded-lg border border-border bg-popover p-0 text-sm text-popover-foreground shadow-xl backdrop:bg-black/40';
const ROW =
  'flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent aria-selected:bg-primary aria-selected:text-primary-foreground';
const BUTTON =
  'h-8 rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring';

const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function pickFolder(title: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = element('dialog', DIALOG);
    dialog.setAttribute('aria-label', title);
    const head = element('div', 'border-b border-border px-4 py-3');
    head.append(
      element('div', 'font-medium', title),
      element(
        'div',
        'mt-0.5 font-mono text-xs text-muted-foreground',
        `${HOME}/code`
      )
    );
    const list = element('div', 'max-h-64 overflow-y-auto p-2');
    list.setAttribute('role', 'listbox');
    let chosen: string | null = null;
    const open = element(
      'button',
      `${BUTTON} bg-primary text-primary-foreground disabled:opacity-50`,
      'Open'
    );
    open.type = 'button';
    open.disabled = true;
    const rows = FOLDERS.map((name) => {
      const row = element('button', ROW);
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.innerHTML = FOLDER_ICON;
      row.append(document.createTextNode(name));
      row.addEventListener('click', () => {
        chosen = `${HOME}/code/${name}`;
        for (const r of rows)
          r.setAttribute('aria-selected', String(r === row));
        open.disabled = false;
      });
      row.addEventListener('dblclick', () => finish(`${HOME}/code/${name}`));
      return row;
    });
    list.append(...rows);
    const cancel = element('button', `${BUTTON} hover:bg-accent`, 'Cancel');
    cancel.type = 'button';
    const foot = element(
      'div',
      'flex justify-end gap-2 border-t border-border px-4 py-3'
    );
    foot.append(cancel, open);
    dialog.append(head, list, foot);

    function finish(path: string | null) {
      dialog.close();
      dialog.remove();
      resolve(path);
    }
    cancel.addEventListener('click', () => finish(null));
    open.addEventListener('click', () => finish(chosen));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });

    document.body.append(dialog);
    dialog.showModal();
    rows[0]?.focus();
  });
}
