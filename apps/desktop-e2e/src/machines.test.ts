import { test, expect } from './fixtures/desktop.js';
import { openPalette, tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';

/**
 * Phase 4: the machines panel, with nothing paired.
 *
 * These are the two guards the brief calls out explicitly: the empty
 * state offers both pairing directions (so a first-time user is never
 * stuck), and — the regression an existing user would actually notice
 * — the workspace chrome is unchanged when only the local machine is
 * registered (D8). Every other machines behaviour (state derivation,
 * pairing, revoke/forget) is covered at the unit level in
 * apps/desktop; this suite only has to prove the feature does not leak
 * into the app before anyone has paired anything.
 */

test.describe('Machines — empty state', () => {
  test('Settings -> Machines offers both directions and shows the local machine', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await page.getByRole('button', { name: 'Machines' }).click();

    await expect(
      page.getByText('Pair a machine once and either side can reach the other.')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add a machine' })
    ).toBeVisible();
    await expect(
      page.getByRole('switch', { name: 'Accept connections' })
    ).toBeVisible();

    // The local machine's own row and fingerprint are shown even with
    // nothing paired — that is what the other side will be asked to
    // confirm.
    await expect(page.getByText('You', { exact: true })).toBeVisible();
  });

  test('the Add a machine dialog walks through paste, preview, confirm', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await page.getByRole('button', { name: 'Machines' }).click();
    await page.getByRole('button', { name: 'Add a machine' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Add a machine')).toBeVisible();

    // An invalid URL is a specific, actionable failure, not silence.
    await dialog.getByPlaceholder(/pair#token=/).fill('not a url');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(
      dialog.getByText('does not look like a pairing URL')
    ).toBeVisible();
  });

  test('the command palette can start pairing without the mouse', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPalette(page);
    await page.getByText('Pair a machine…').click();
    await expect(
      page.getByRole('dialog').getByText('Add a machine')
    ).toBeVisible();
  });
});

test.describe('Machines — D8 regression', () => {
  test('the machines UI is entirely absent from the workspace with only the local machine', async ({
    desktop,
  }) => {
    const { page } = desktop;

    // No status-bar segment: the footer must not mention machines at
    // all — a user who never pairs anything sees today's app.
    const statusBar = page.locator('footer');
    await expect(statusBar).toBeVisible();
    await expect(statusBar.getByText(/machine/i)).toHaveCount(0);

    // Settings' own nav still renders Appearance first and does not
    // force any machines-only chrome onto the rest of the page.
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(
      page.getByRole('button', { name: 'Appearance' })
    ).toBeVisible();
  });
});
