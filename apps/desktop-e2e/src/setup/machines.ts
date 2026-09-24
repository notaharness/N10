import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { tab } from './app.js';
import { clickAppMenuItem } from './menu.js';

/** Opens Settings on its Machines group. */
export async function openMachines(desktop: {
  app: ElectronApplication;
  page: Page;
}): Promise<void> {
  await clickAppMenuItem(desktop.app, 'Settings…');
  await expect(tab(desktop.page, /Settings/)).toBeVisible();
  await desktop.page
    .getByRole('button', { name: 'Machines', exact: true })
    .click();
}
