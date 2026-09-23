import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures/desktop.js';
import { tab } from './setup/app.js';
import {
  FakeBeam,
  ceremonyUrl,
  type FakeBeamScenario,
} from './setup/fake-beam.js';
import { clickAppMenuItem } from './setup/menu.js';

/**
 * The machines panel over beam's control socket, with a scripted daemon
 * in the fixture HOME: enrolment with its passkey link, and a member's
 * row menu. The fake starts before the app, which finds it at launch.
 */
const test = base.extend<{
  beamScenario: FakeBeamScenario | null;
  beam: FakeBeam | null;
}>({
  beamScenario: [null, { option: true }],
  beam: async ({ fixtureHome, beamScenario }, provide) => {
    const beam = beamScenario
      ? await FakeBeam.start(fixtureHome, beamScenario)
      : null;
    await provide(beam);
    await beam?.close();
  },
  desktop: async ({ beam, desktop }, provide) => {
    void beam; // started first, so the app connects at launch
    await provide(desktop);
  },
});

const WORKBOX = 'c0ffee00c0ffee00c0ffee00c0ffee00';

async function openMachines(desktop: {
  app: Parameters<typeof clickAppMenuItem>[0];
  page: Page;
}): Promise<void> {
  await clickAppMenuItem(desktop.app, 'Settings…');
  await expect(tab(desktop.page, /Settings/)).toBeVisible();
  await desktop.page
    .getByRole('button', { name: 'Machines', exact: true })
    .click();
}

test.describe('Machines over beam', () => {
  test('starts beam when none is running, and stops it on quit', async ({
    desktop,
    fixtureHome,
  }) => {
    await openMachines(desktop);
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
    await openMachines(desktop);
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
      await openMachines(desktop);
      await expect(
        desktop.page.getByRole('button', { name: 'Create a fleet' })
      ).toBeVisible();
      await desktop.app.close();
      expect(beam!.ops('daemon.shutdown')).toHaveLength(0);
    });
  });

  test.describe('an unenrolled daemon', () => {
    test.use({ beamScenario: { enrolled: false } });

    test('creates a fleet: stages, the passkey link as QR and text, then this machine', async ({
      desktop,
      beam,
    }) => {
      const { page } = desktop;
      await openMachines(desktop);
      await page.getByLabel("This machine's name").fill('laptop');
      await page.getByLabel('Fleet name (to create one)').fill('home');
      await page.getByRole('button', { name: 'Create a fleet' }).click();

      await expect(
        page.getByText('waiting for your passkey (create)')
      ).toBeVisible();
      await expect(page.getByTestId('ceremony-url')).toHaveText(
        ceremonyUrl('init', 'sign')
      );
      await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Open in browser' })
      ).toBeVisible();
      expect(beam!.ops('init.start')[0]).toMatchObject({
        label: 'laptop',
        fleetName: 'home',
      });

      beam!.finishCeremony();
      await expect(
        page.getByText(/^Created fleet 3f9a 0c4e 7d12 e805/)
      ).toBeVisible();
      await expect(page.getByTestId('machine-row')).toHaveCount(1);
      await expect(page.getByText('You', { exact: true })).toBeVisible();
    });
  });

  test.describe('an enrolled daemon with a member', () => {
    test.use({
      beamScenario: {
        enrolled: true,
        peers: [{ peerId: WORKBOX, label: 'workbox' }],
      },
    });

    test('renames, re-grants and revokes a member through beam', async ({
      desktop,
      beam,
    }) => {
      const { page } = desktop;
      await openMachines(desktop);
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
      await expect(row.getByText('messages only')).toBeVisible();

      await row.getByRole('button', { name: 'Machine actions' }).click();
      await page.getByRole('menuitem', { name: 'Revoke…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Revoke' }).click();
      await expect(dialog.getByTestId('ceremony-url')).toHaveText(
        ceremonyUrl('revoke', 'first')
      );
      beam!.finishCeremony();
      await expect(
        dialog.getByText(/^Revoked here · published · acknowledged by 0 of 0/)
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
    });
  });
});
