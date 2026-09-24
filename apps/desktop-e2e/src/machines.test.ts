import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { openFleet } from './setup/machines.js';

/**
 * Fleet over beam's control socket: the daemon the app starts or
 * finds, and a member's row menu over a scripted one.
 */

test.describe('Machines over beam', () => {
  test('starts beam when none is running, and stops it on quit', async ({
    desktop,
    fixtureHome,
  }) => {
    await openFleet(desktop);
    await expect(
      desktop.page.getByRole('button', { name: 'Create a fleet' })
    ).toBeVisible();
    const socket = join(fixtureHome, '.config', 'beam', 'run', 'beam.sock');
    expect(existsSync(socket)).toBe(true);

    await desktop.app.close();
    expect(existsSync(socket)).toBe(false);
  });

  test('a crash of the app takes the beam it started with it', async ({
    desktop,
    fixtureHome,
  }) => {
    await openFleet(desktop);
    await expect(
      desktop.page.getByRole('button', { name: 'Create a fleet' })
    ).toBeVisible();
    const socket = join(fixtureHome, '.config', 'beam', 'run', 'beam.sock');
    expect(existsSync(socket)).toBe(true);

    desktop.app.process().kill('SIGKILL');
    await expect
      .poll(() => existsSync(socket), { timeout: 20_000 })
      .toBe(false);
  });

  test.describe('a daemon already running', () => {
    test.use({ beamScenario: { enrolled: false } });

    test('is used and left running on quit', async ({ desktop, beam }) => {
      await openFleet(desktop);
      await expect(
        desktop.page.getByRole('button', { name: 'Create a fleet' })
      ).toBeVisible();
      await desktop.app.close();
      expect(beam!.ops('daemon.shutdown')).toHaveLength(0);
    });
  });

  test.describe('an enrolled daemon with a member', () => {
    test.use({
      beamScenario: {
        enrolled: true,
        peers: [{ peerId: WORKBOX, label: 'workbox' }],
      },
    });

    test('renames and re-grants a member through beam', async ({
      desktop,
      beam,
    }) => {
      const { page } = desktop;
      await openFleet(desktop);
      const row = page.locator(`[data-peer-id="${WORKBOX}"]`);
      await expect(row.getByText('workbox')).toBeVisible();
      await expect(row.getByText('Connected')).toBeVisible();

      await row.getByRole('button', { name: 'Machine actions' }).click();
      await page.getByRole('menuitem', { name: 'Rename here…' }).click();
      await row.getByLabel('Name on this machine').fill('build');
      await row.getByLabel('Name on this machine').press('Enter');
      await expect(row.getByText('build')).toBeVisible();
      expect(beam!.ops('peer.alias')[0]).toMatchObject({
        peer: WORKBOX,
        alias: 'build',
      });

      await row.getByRole('button', { name: 'Machine actions' }).click();
      await page
        .getByRole('menuitemcheckbox', { name: 'Messages only' })
        .click();
      await expect(row.getByText('Messages only')).toBeVisible();
    });
  });
});
