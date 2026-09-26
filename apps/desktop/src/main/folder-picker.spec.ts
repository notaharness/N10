import { describe, expect, it, vi } from 'vitest';

const showOpenDialog = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: () => '/home/me' },
  dialog: { showOpenDialog },
}));

const { pickFolderWithDialog } = await import('./folder-picker.js');

describe('pickFolderWithDialog', () => {
  it('starts at home, then beside the last pick, which a cancel keeps', async () => {
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/home/me/code/n10'],
    });
    await expect(pickFolderWithDialog('Open repository')).resolves.toBe(
      '/home/me/code/n10'
    );
    expect(showOpenDialog.mock.calls[0][0].defaultPath).toBe('/home/me');

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(pickFolderWithDialog('Open folder')).resolves.toBeNull();
    expect(showOpenDialog.mock.calls[1][0].defaultPath).toBe('/home/me/code');

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await pickFolderWithDialog('Open folder');
    expect(showOpenDialog.mock.calls[2][0].defaultPath).toBe('/home/me/code');
  });
});
