import { test, expect } from './fixtures/fake-beam.js';
import { tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import { ceremonyUrl } from './setup/fake-beam.js';
import { fleetView, leaveFleet, openFleet } from './setup/machines.js';

/**
 * Fleet is a destination of its own (beam-fleet-ux.md §1): reachable
 * from the title bar with or without a repository, from the sidebar,
 * and from Settings' short link; leaving it returns to the screen
 * underneath without remounting it or losing a running ceremony.
 */

test.describe('Fleet destination', () => {
  test.use({ beamScenario: { enrolled: false } });

  test.describe('before a repository is open', () => {
    test.use({ startWithoutRepo: true });

    test('opens from the title bar and returns to the repository picker', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await openFleet(desktop);
      const fleet = fleetView(page);
      await expect(
        fleet.getByRole('heading', { name: 'Fleet', exact: true })
      ).toBeVisible();
      await expect(
        fleet.getByText(
          'Connect your machines with beam. Run shells, commands and agent messages between them.'
        )
      ).toBeVisible();
      await expect(
        fleet.getByRole('heading', { name: 'Connect your first machine' })
      ).toBeVisible();

      await leaveFleet(page);
      await expect(
        page.getByRole('button', { name: 'Open repository…' })
      ).toBeVisible();
    });
  });

  test('keeps the workspace mounted underneath', async ({ desktop }) => {
    const { page } = desktop;
    const workspace = page.getByTestId('workspace-screen');
    await workspace.evaluate((el) => {
      el.dataset.probe = 'kept';
    });

    await openFleet(desktop);
    await expect(workspace).toBeHidden();
    await leaveFleet(page);

    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveAttribute('data-probe', 'kept');
  });

  test('opens from the sidebar, and from the title bar with the sidebar hidden', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'Fleet' })
      .click();
    await expect(fleetView(page)).toBeVisible();
    await leaveFleet(page);

    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await openFleet(desktop);
  });

  test('keeps a running ceremony across Back to workspace', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const fleet = fleetView(page);
    await fleet.getByRole('button', { name: 'Create a fleet' }).click();
    await expect(fleet.getByTestId('ceremony-url')).toBeVisible();

    await leaveFleet(page);
    await openFleet(desktop);
    await expect(fleet.getByTestId('ceremony-url')).toBeVisible();
    expect(beam!.ops('init.start')).toHaveLength(1);
    expect(beam!.ops('ceremony.cancel')).toHaveLength(0);
  });

  test('the palette shortcut leaves Fleet for the palette', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog')).toBeVisible();
    // By the DOM: the palette is modal, so Fleet would be hidden from
    // the accessibility tree behind it either way.
    await expect(page.locator('section[aria-label="Fleet"]')).toHaveCount(0);
  });

  test('Settings links to Fleet instead of enrolling there', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();
    await page.getByRole('button', { name: 'Machines', exact: true }).click();
    await expect(
      page.getByText(
        'Manage your machines, passkeys and fleet recovery in Fleet.'
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Create a fleet/ })
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Open Fleet' }).click();
    await expect(fleetView(page)).toBeVisible();
  });

  test.describe('with a member', () => {
    test.use({
      beamScenario: {
        enrolled: true,
        peers: [
          { peerId: 'c0ffee00c0ffee00c0ffee00c0ffee00', label: 'workbox' },
        ],
      },
    });

    test('a revocation waiting on its passkey outlives leaving Fleet', async ({
      desktop,
      beam,
    }) => {
      const { page } = desktop;
      await openFleet(desktop);
      const row = page
        .getByTestId('machine-row')
        .filter({ hasText: 'workbox' });
      await row.getByRole('button', { name: 'Machine actions' }).click();
      await page.getByRole('menuitem', { name: 'Revoke…' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Revoke' })
        .click();
      await expect(page.getByTestId('ceremony-url')).toHaveText(
        ceremonyUrl('revoke', 'first')
      );

      await clickAppMenuItem(desktop.app, 'Settings…');
      await expect(fleetView(page)).toBeHidden();
      // Not `openFleet`: the dialog is modal, so Fleet is hidden behind it.
      await page
        .getByRole('banner')
        .getByRole('button', { name: 'Fleet', exact: true })
        .click();
      await expect(
        page.getByRole('dialog').getByTestId('ceremony-url')
      ).toBeVisible();
      expect(beam!.ops('ceremony.cancel')).toHaveLength(0);
    });
  });
});
