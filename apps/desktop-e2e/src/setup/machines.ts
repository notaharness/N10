import { expect, type Page } from '@playwright/test';

/** The Fleet section's header, in whichever sidebar is showing: the
 *  workspace's, or the repository picker's. */
export function fleetToggle(page: Page) {
  return page
    .getByRole('complementary')
    .getByRole('button', { name: /^Fleet/ });
}

export function fleetView(page: Page) {
  return page.getByRole('region', { name: 'Fleet' });
}

/** Expands the sidebar's Fleet section, if it is not already. */
export async function openFleet(desktop: { page: Page }): Promise<void> {
  const toggle = fleetToggle(desktop.page);
  await expect(toggle).toHaveAttribute('aria-expanded', /true|false/);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(fleetView(desktop.page)).toBeVisible();
}

/** Collapses the Fleet section, unmounting its body. */
export async function collapseFleet(page: Page): Promise<void> {
  await fleetToggle(page).click();
  await expect(fleetView(page)).toHaveCount(0);
}
