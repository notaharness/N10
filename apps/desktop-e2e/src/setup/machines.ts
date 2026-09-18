import {
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { clickAppMenuItem } from './menu.js';
import { tab } from './app.js';

/**
 * Driving the machines UI the way a user does — Settings → Machines and
 * the "Add a machine" dialog's two-step confirm — shared by
 * `machines.test.ts` and `machines-visual.test.ts` so neither reinvents
 * the sequence `PairMachineDialog.tsx` actually implements.
 */

export async function openMachinesSettings(
  app: ElectronApplication,
  page: Page
): Promise<void> {
  await clickAppMenuItem(app, 'Settings…');
  await expect(tab(page, /Settings/)).toBeVisible();
  await page.getByRole('button', { name: 'Machines' }).click();
}

export async function openAddMachineDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add a machine' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Add a machine')).toBeVisible();
  return dialog;
}

/** Step 1: paste and preview. Nothing is stored yet — the caller can
 *  screenshot this exact moment (the security-relevant confirm screen)
 *  before ever calling `confirmPairing`. */
export async function previewPairingUrl(
  dialog: Locator,
  url: string
): Promise<void> {
  await dialog.getByPlaceholder(/pair#token=/).fill(url);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Fingerprint')).toBeVisible();
}

/** Step 2: spend the token. Waits for the paired row to read `Reachable`
 *  — the live probe a real second `Host` answers — rather than a fixed
 *  delay. */
export async function confirmPairing(
  page: Page,
  dialog: Locator
): Promise<void> {
  await dialog.getByRole('button', { name: 'Pair' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await expect(page.getByText('Reachable')).toBeVisible();
}

/** The whole "Add a machine" flow against a real pairing URL, ending with
 *  the newly paired peer visible and `Reachable`. */
export async function pairWithUrl(page: Page, url: string): Promise<void> {
  const dialog = await openAddMachineDialog(page);
  await previewPairingUrl(dialog, url);
  await confirmPairing(page, dialog);
}
