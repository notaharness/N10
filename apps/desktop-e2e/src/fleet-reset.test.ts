import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { fleetView, openFleet } from './setup/machines.js';

/**
 * Resetting this machine's fleet (beam-fleet-ux.md §3): an explicit,
 * typed confirmation that calls beam's `fleet.reset`, and nothing else.
 */

test.describe('Reset fleet on this machine', () => {
  test.use({
    beamScenario: {
      enrolled: true,
      peers: [{ peerId: WORKBOX, label: 'workbox' }],
    },
  });

  test('needs reset typed exactly, and can be cancelled', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await fleetView(page)
      .getByRole('button', { name: 'Reset fleet on this machine…' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Reset fleet on this machine?' })
    ).toBeVisible();
    await expect(
      dialog.getByText(
        /Its machine identity is kept\. Other machines and the fleet passkey are not reset or revoked\./
      )
    ).toBeVisible();
    const confirm = dialog.getByLabel('Type reset to confirm');
    const reset = dialog.getByRole('button', { name: 'Reset fleet' });
    await expect(reset).toBeDisabled();
    await confirm.fill('Reset');
    await expect(reset).toBeDisabled();
    await confirm.fill('reset ');
    await expect(reset).toBeDisabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(beam!.ops('fleet.reset')).toHaveLength(0);
    await expect(page.getByTestId('machine-row')).toHaveCount(2);
  });

  test('resets through beam, then offers to create or join', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await fleetView(page)
      .getByRole('button', { name: 'Reset fleet on this machine…' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type reset to confirm').fill('reset');
    await dialog.getByLabel('Type reset to confirm').press('Enter');

    await expect(
      dialog.getByText(
        'Fleet reset on this machine. Create a fleet or join one to continue.'
      )
    ).toBeVisible();
    expect(beam!.ops('fleet.reset')).toEqual([
      expect.objectContaining({ confirm: 'reset' }),
    ]);
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(
      fleetView(page).getByRole('heading', {
        name: 'Connect your first machine',
      })
    ).toBeVisible();
    await expect(page.getByTestId('machine-row')).toHaveCount(0);
  });

  test('a refused reset keeps the confirmation and says why', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    beam!.refuse('fleet.reset', 'storage-failure', 'disk full');
    await openFleet(desktop);
    await fleetView(page)
      .getByRole('button', { name: 'Reset fleet on this machine…' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type reset to confirm').fill('reset');
    await dialog.getByRole('button', { name: 'Reset fleet' }).click();
    await expect(
      dialog.getByText('Could not reset this machine’s fleet. disk full')
    ).toBeVisible();
    await expect(dialog.getByLabel('Type reset to confirm')).toHaveValue(
      'reset'
    );
    await expect(page.getByTestId('machine-row')).toHaveCount(2);
  });
});

test.describe('after creating a fleet', () => {
  test.use({ beamScenario: { enrolled: false } });

  test('a reset clears the creation’s result', async ({ desktop, beam }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await view.getByRole('button', { name: 'Create fleet' }).click();
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.nextPasskeyStep();
    beam!.finishCeremony();
    await expect(
      view.getByRole('heading', { name: 'Fleet created' })
    ).toBeVisible();

    await view
      .getByRole('button', { name: 'Reset fleet on this machine…' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type reset to confirm').fill('reset');
    await dialog.getByRole('button', { name: 'Reset fleet' }).click();
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(
      view.getByRole('heading', { name: 'Connect your first machine' })
    ).toBeVisible();
    await expect(
      view.getByRole('heading', { name: 'Fleet created' })
    ).toHaveCount(0);
  });
});
