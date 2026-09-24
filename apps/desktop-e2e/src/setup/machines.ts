import { expect, type Page } from '@playwright/test';

/** The Fleet view, opened from the title bar. */
export async function openFleet(desktop: { page: Page }): Promise<void> {
  await desktop.page
    .getByRole('banner')
    .getByRole('button', { name: 'Fleet', exact: true })
    .click();
  await expect(fleetView(desktop.page)).toBeVisible();
}

export function fleetView(page: Page) {
  return page.getByRole('region', { name: 'Fleet' });
}

/** Back to the screen under Fleet. */
export async function leaveFleet(page: Page): Promise<void> {
  await fleetView(page)
    .getByRole('button', { name: 'Back to workspace' })
    .click();
  await expect(fleetView(page)).toBeHidden();
}
