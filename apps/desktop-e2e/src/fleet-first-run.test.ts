import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { fleetView, openFleet } from './setup/machines.js';

/**
 * The guided first run and the passkey steps (beam-fleet-ux.md §2–§4),
 * over a scripted daemon that a test walks through each signal.
 */

async function startCreate(page: Page, label = 'laptop', fleet = 'home') {
  const view = fleetView(page);
  await view.getByRole('button', { name: 'Create a fleet' }).click();
  await view.getByLabel('This machine’s name').fill(label);
  await view.getByLabel('Fleet name').fill(fleet);
  await view.getByRole('button', { name: 'Create fleet' }).click();
}

function step(page: Page, name: string) {
  return fleetView(page).getByRole('listitem').filter({ hasText: name });
}

test.describe('First run', () => {
  test.use({ beamScenario: { enrolled: false } });

  test('creates a fleet through both passkey steps, each with its own link', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await expect(
      view.getByRole('heading', { name: 'Create a fleet' })
    ).toBeVisible();
    await expect(view.getByLabel('This machine’s name')).toHaveAttribute(
      'placeholder',
      'Host name'
    );
    await expect(
      view.getByText('The fleet name appears in your passkey manager.')
    ).toBeVisible();
    await expect(
      view.getByText(
        'Two passkey prompts, once per fleet. Each prompt has its own link and QR code.'
      )
    ).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Passkey compatibility' })
    ).toBeVisible();

    await view.getByLabel('This machine’s name').fill('laptop');
    await view.getByLabel('Fleet name').fill('home');
    await view.getByRole('button', { name: 'Create fleet' }).dblclick();

    await expect(
      view.getByRole('heading', {
        name: 'Step 1 of 2 · Create your fleet passkey',
      })
    ).toBeVisible();
    expect(beam!.ops('init.start')).toHaveLength(1);
    expect(beam!.ops('init.start')[0]).toMatchObject({
      label: 'laptop',
      fleetName: 'home',
    });
    const first = beam!.currentUrl;
    await expect(view.getByTestId('ceremony-url')).toHaveText(first);
    await expect(
      view.getByText('Create fleet passkey for “home”')
    ).toBeVisible();
    await expect(view.getByRole('img', { name: /QR code/ })).toBeVisible();
    await expect(step(page, 'Create your fleet passkey')).toHaveAttribute(
      'aria-current',
      'step'
    );

    const second = beam!.nextPasskeyStep();
    await expect(
      view.getByRole('heading', {
        name: 'Step 2 of 2 · Authorize this machine',
      })
    ).toBeVisible();
    await expect(view.getByTestId('ceremony-url')).toHaveText(second);
    await expect(view.getByText(first)).toHaveCount(0);
    await expect(view.getByText('Add “laptop” to fleet')).toBeVisible();
    await expect(step(page, 'Create your fleet passkey')).toContainText(
      '(done)'
    );

    beam!.stage('publishing');
    await expect(
      view.getByRole('heading', { name: 'Publishing membership…' })
    ).toBeVisible();
    await expect(view.getByTestId('ceremony-url')).toHaveCount(0);
    await expect(
      view.getByRole('button', { name: 'Cancel setup' })
    ).toHaveCount(0);

    beam!.finishCeremony();
    await expect(
      view.getByRole('heading', { name: 'Fleet created' })
    ).toBeVisible();
    await expect(view.getByText('Published to directory')).toBeVisible();
    await expect(page.getByTestId('machine-row')).toHaveCount(1);
    await view.getByRole('button', { name: 'Close' }).click();
    await expect(
      view.getByRole('heading', { name: 'Fleet created' })
    ).toHaveCount(0);
  });

  test('refuses a name beam would refuse, without rewriting it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await view.getByLabel('Fleet name').fill('home/office');
    await expect(
      view.getByText(
        'Use 1–64 characters without /, \\, {, }, or control characters. Leave blank to use the default.'
      )
    ).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Create fleet' })
    ).toBeDisabled();
    await expect(view.getByLabel('Fleet name')).toHaveValue('home/office');
  });

  test('cancelling step 2 never marks it done; Try again starts afresh, Back keeps the names', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await startCreate(page);
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.nextPasskeyStep();
    await expect(
      view.getByRole('heading', {
        name: 'Step 2 of 2 · Authorize this machine',
      })
    ).toBeVisible();

    await view.getByRole('button', { name: 'Cancel setup' }).click();
    await expect(
      view.getByText(
        'Passkey request cancelled. No further approval is pending for this request.'
      )
    ).toBeVisible();
    expect(beam!.ops('ceremony.cancel')).toHaveLength(1);
    await expect(step(page, 'Authorize this machine')).toContainText(
      '(stopped)'
    );
    await expect(
      view.getByText(/If you saved a passkey before this stopped/)
    ).toBeVisible();
    await expect(
      view.locator('code', { hasText: 'ceremony-cancelled' })
    ).toBeVisible();
    await expect(view.getByTestId('ceremony-url')).toHaveCount(0);

    await view.getByRole('button', { name: 'Try again' }).click();
    await expect(
      view.getByRole('heading', {
        name: 'Step 1 of 2 · Create your fleet passkey',
      })
    ).toBeVisible();
    expect(beam!.ops('init.start')).toHaveLength(2);

    beam!.failCeremony('ceremony-timeout');
    await expect(
      view.getByText(/This passkey request expired after five minutes/)
    ).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Back', exact: true })
    ).toHaveCount(0);
    await view.getByRole('button', { name: 'Close' }).click();
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await expect(view.getByLabel('This machine’s name')).toHaveValue('laptop');
    await expect(view.getByLabel('Fleet name')).toHaveValue('home');
  });

  test('a PRF failure opens the compatibility help; beam’s detail shows as text', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Join an existing fleet' }).click();
    await expect(
      view.getByText(
        'Use the passkey you created for this fleet. One passkey prompt authorizes this machine.'
      )
    ).toBeVisible();
    await expect(view.getByLabel('Fleet name')).toHaveCount(0);
    await view.getByRole('button', { name: 'Join fleet' }).click();
    await expect(
      view.getByRole('heading', { name: 'Authorize this machine' })
    ).toBeVisible();
    await expect(
      view.getByText(
        'Choose this fleet’s existing passkey. Do not create another passkey.'
      )
    ).toBeVisible();

    beam!.failCeremony('prf-unsupported', '<b>no prf.results.first</b>');
    await expect(
      view.getByText(/The selected passkey did not provide WebAuthn PRF/)
    ).toBeVisible();
    await expect(view.getByText('<b>no prf.results.first</b>')).toBeVisible();
    await expect(
      view.getByText(
        'Use the same fleet passkey; a new passkey creates a different fleet.'
      )
    ).toBeVisible();
    await expect(view.getByText(/Firefox 139\+ on desktop/)).toBeVisible();
    await view.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(
      view.getByRole('heading', { name: 'Join an existing fleet' })
    ).toBeVisible();
  });

  test('another client’s ceremony: back, never retry', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await startCreate(page);
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.failCeremony('busy');
    await expect(
      view.getByText(/Another passkey request is already running/)
    ).toBeVisible();
    await expect(view.getByRole('button', { name: 'Try again' })).toHaveCount(
      0
    );
    await view.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(
      view.getByRole('heading', { name: 'Create a fleet' })
    ).toBeVisible();
  });

  test('a pending publication is saved, not failed', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await startCreate(page);
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.nextPasskeyStep();
    beam!.finishCeremony('pending');
    await expect(
      view.getByText(
        'Saved on this machine. Directory publication is pending; beam will retry while it runs.'
      )
    ).toBeVisible();
  });
});

test.describe('Revoking a member', () => {
  test.use({
    beamScenario: {
      enrolled: true,
      peers: [{ peerId: WORKBOX, label: 'workbox' }],
    },
  });

  test('asks for the passkey, shows what it removes, and reports the outcome', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const row = page.locator(`[data-peer-id="${WORKBOX}"]`);
    await row.getByRole('button', { name: 'Machine actions' }).click();
    await page.getByRole('menuitem', { name: 'Revoke workbox…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('c0ff ee00 c0ff ee00')).toBeVisible();
    await expect(
      dialog.getByText(/^Permanently remove workbox from this fleet\./)
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Continue to passkey' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Authorize revocation' })
    ).toBeVisible();
    await expect(dialog.getByText('Remove “workbox” from fleet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    beam!.failCeremony('bad-assertion');
    await expect(dialog.getByText(/The passkey request failed/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
    expect(beam!.ops('revoke.start')).toHaveLength(2);

    beam!.stage('notifying peers');
    await expect(
      dialog.getByRole('heading', { name: 'Notifying peers…' })
    ).toBeVisible();
    await expect(dialog.getByTestId('ceremony-url')).toHaveCount(0);

    beam!.finishCeremony();
    await expect(
      dialog.getByText('Revoked workbox on this machine.')
    ).toBeVisible();
    await expect(
      dialog.getByText(
        'Acknowledged by 0 peers. Offline peers learn when they connect.'
      )
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
  });
});
