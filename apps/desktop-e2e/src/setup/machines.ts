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

/** The settings nav's own Machines entry. `exact` because accessible-name
 *  matching is substring and case-insensitive by default, and the status
 *  bar renders a second `role="button"` named after its own text —
 *  `"2 machines"`, `"3 machines · 1 unreachable"` — the moment a peer is
 *  registered. Exact matching is full-string and case-sensitive, so it
 *  picks the nav button whether or not that segment is on screen. */
export function machinesNavButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Machines', exact: true });
}

/** The loopback endpoint a live `startPeerHost` advertises. The port is
 *  OS-assigned, so this is the one thing about a `reachable` row a
 *  screenshot cannot hold still — masked wherever it is rendered, and
 *  asserted visible first so a mask that stops applying fails as a
 *  locator error rather than as an intermittent pixel diff. */
export const PEER_ENDPOINT_TEXT = /^http:\/\/127\.0\.0\.1:\d+$/;

/** Every row of the machines panel, counted by the per-row actions
 *  menu `MachineRow` always renders. An aria-label rather than a class:
 *  it names what is being counted, and survives restyling. */
export function machineRows(page: Page): Locator {
  return page.getByRole('button', { name: 'Machine actions' });
}

export async function openMachinesSettings(
  app: ElectronApplication,
  page: Page
): Promise<void> {
  await clickAppMenuItem(app, 'Settings…');
  await expect(tab(page, /Settings/)).toBeVisible();
  await machinesNavButton(page).click();
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
  // `exact` — the card's own explainer ("Compare the fingerprint with
  // what the other machine shows…") is a second, case-insensitive
  // substring match for this field label.
  await expect(dialog.getByText('Fingerprint', { exact: true })).toBeVisible();
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
  // `exact` — `Unreachable` (machine-model.ts's STATE_LABEL for the
  // seeded stale peer) contains `Reachable`, and text matching is
  // substring and case-insensitive by default.
  await expect(page.getByText('Reachable', { exact: true })).toBeVisible();
}

/** The whole "Add a machine" flow against a real pairing URL, ending with
 *  the newly paired peer visible and `Reachable`. `inspectPreview` runs
 *  on the confirm step, before the token is spent — the one moment at
 *  which nothing has been stored yet. */
export async function pairWithUrl(
  page: Page,
  url: string,
  inspectPreview?: (dialog: Locator) => Promise<void>
): Promise<void> {
  const dialog = await openAddMachineDialog(page);
  await previewPairingUrl(dialog, url);
  await inspectPreview?.(dialog);
  await confirmPairing(page, dialog);
}
