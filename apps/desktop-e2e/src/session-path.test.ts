import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { focusTerminal, visibleText } from './setup/app.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
} from './setup/terminals.js';

/**
 * A session the desktop launches reaches the app's own `n10` and `beam`
 * on its PATH, with no n10 CLI installed (the fixture PATH has none),
 * and the beam directory the app uses.
 */
test.describe('Session PATH', () => {
  test('a shell runs `n10 util add-comment` and the app’s beam', async ({
    desktop,
    fixtureHome,
  }) => {
    const { app, page } = desktop;
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    // The prompt has to be up first: a keystroke sent while the shell
    // is still starting is read in cooked mode and lost.
    await expect(
      page.locator('[data-terminal-pane]').getByText(/\S/).first()
    ).toBeVisible({ timeout: 15_000 });
    await focusTerminal(page);
    await page.keyboard.type(
      'n10 util add-comment --pr=7 --file=a.ts --lineStart=1 --lineEnd=1 --severity=nit --body=from-a-session' +
        ' && echo "beam=$(beam version) dir=$BEAM_CONFIG_DIR"\n',
      { delay: 10 }
    );

    await expect(
      visibleText(page, `dir=${fixtureHome}/.config/beam`)
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(page, /beam=\d+\.\d+\.\d+\S* dir=/)).toBeVisible();
    const stored = JSON.parse(
      readFileSync(
        join(fixtureHome, '.n10', 'reviews', 'pr-7', 'comments.json'),
        'utf8'
      )
    ) as { comments: { body: string; file: string }[] };
    expect(stored.comments).toEqual([
      expect.objectContaining({ file: 'a.ts', body: 'from-a-session' }),
    ]);
  });
});
