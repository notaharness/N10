import { dirname } from 'node:path';
import { app, dialog } from 'electron';

let lastPickedParent: string | undefined;

/**
 * Native folder picker. Without a defaultPath Electron opens dialogs in
 * Downloads, so it starts beside the last pick, or at home.
 */
export async function pickFolderWithDialog(
  title: string
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title,
    defaultPath: lastPickedParent ?? app.getPath('home'),
  });
  const [picked] = result.filePaths;
  if (result.canceled || !picked) return null;
  lastPickedParent = dirname(picked);
  return picked;
}
