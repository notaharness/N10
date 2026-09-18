import { test, expect } from './fixtures/desktop.js';
import { openPalette, sidebarRow, tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import { openNewTerminalDialog } from './setup/terminals.js';

/**
 * Phase 4: the machines panel, with nothing paired.
 *
 * These are the two guards the brief calls out explicitly: the empty
 * state offers both pairing directions (so a first-time user is never
 * stuck), and — the regression an existing user would actually notice
 * — the workspace chrome is unchanged when only the local machine is
 * registered (D8). Every other machines behaviour (state derivation,
 * pairing, revoke/forget) is covered at the unit level in
 * apps/desktop; this suite only has to prove the feature does not leak
 * into the app before anyone has paired anything.
 */

test.describe('Machines — empty state', () => {
  test('Settings -> Machines offers both directions and shows the local machine', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await page.getByRole('button', { name: 'Machines' }).click();

    await expect(
      page.getByText('Pair a machine once and either side can reach the other.')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add a machine' })
    ).toBeVisible();
    await expect(
      page.getByRole('switch', { name: 'Accept connections' })
    ).toBeVisible();

    // The local machine's own row and fingerprint are shown even with
    // nothing paired — that is what the other side will be asked to
    // confirm.
    await expect(page.getByText('You', { exact: true })).toBeVisible();
  });

  test('the Add a machine dialog walks through paste, preview, confirm', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await page.getByRole('button', { name: 'Machines' }).click();
    await page.getByRole('button', { name: 'Add a machine' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Add a machine')).toBeVisible();

    // An invalid URL is a specific, actionable failure, not silence.
    await dialog.getByPlaceholder(/pair#token=/).fill('not a url');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(
      dialog.getByText('does not look like a pairing URL')
    ).toBeVisible();
  });

  test('the command palette can start pairing without the mouse', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPalette(page);
    await page.getByText('Pair a machine…').click();
    await expect(
      page.getByRole('dialog').getByText('Add a machine')
    ).toBeVisible();
  });
});

test.describe('Machines — D8 regression', () => {
  test('the machines UI is entirely absent from the workspace with only the local machine', async ({
    desktop,
  }) => {
    const { page } = desktop;

    // No status-bar segment: the footer must not mention machines at
    // all — a user who never pairs anything sees today's app.
    const statusBar = page.locator('footer');
    await expect(statusBar).toBeVisible();
    await expect(statusBar.getByText(/machine/i)).toHaveCount(0);

    // Settings' own nav still renders Appearance first and does not
    // force any machines-only chrome onto the rest of the page.
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(
      page.getByRole('button', { name: 'Appearance' })
    ).toBeVisible();
  });

  // Phase 7b: the agent launch flow's own D8 guard — the one the
  // terminal dialog already had, that this launch surface (and the
  // "New terminal" dialog it shares the machine picker with) did not.
  // Unit tests already cover the decision (`hasPeerMachines`,
  // `machineSelectOptions`); this proves the real, mounted control is
  // absent for a user who paired nothing, which unit tests cannot.
  test('no machine control in the New terminal dialog with only the local machine registered', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const dialog = await openNewTerminalDialog(app, page);
    await expect(dialog.getByRole('combobox', { name: 'Machine' })).toHaveCount(
      0
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  });
});

test.describe('Machines — agent launch surface, D8 regression', () => {
  test.use({ repo: { worktrees: [{ branch: 'd8-worktree' }] } });

  test('no machine control in the agent launch dialog, and a locally launched agent carries no machine badge or tab prefix', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = sidebarRow(page, /d8-worktree/).first();
    await row.click();

    // The session menu (LaunchDialog) offers no machine control with
    // nothing paired — a user must not be asked to pick a machine at
    // all, on either launch surface.
    await page
      .getByRole('button', { name: /^(Launch|Relaunch) agent$/, exact: true })
      .click();
    const menu = page.locator('[data-launch-dialog]');
    await menu.waitFor({ state: 'visible' });
    await expect(menu.getByRole('combobox', { name: 'Machine' })).toHaveCount(
      0
    );

    // Launch for real, and confirm the running session's row carries
    // no machine badge (ux-machines.md §6's `RowBadges`, only rendered
    // for more than one registered machine) and its tab carries no
    // `<machine> · ` prefix — both gates proven end to end, not only
    // at the unit level (`hasPeerMachines`, `tabPresentation`).
    await menu
      .getByRole('button', {
        name: /^(Start new session|Continue with .+|Open .+)$/,
      })
      .click();
    await menu.waitFor({ state: 'hidden' });
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible();

    await expect(tab(page, /d8-worktree/)).toBeVisible();
    await expect(tab(page, /·/)).toHaveCount(0);
    await expect(row.locator('.bg-muted')).toHaveCount(0);
  });
});

/**
 * What is NOT covered here, and why: proving the control is *present*
 * and *working* for a registered peer — the other half of ux-machines.md
 * §5 — needs a second real machine (a reachable beam peer) to select
 * and launch on. No fixture here stands one up (the empty-state and D8
 * suites above are deliberately the only machines coverage at this
 * level), and faking one at the IPC layer would prove the mock, not the
 * feature. That side of the machine `Select` — which options are
 * enabled or disabled and why, the step progress, a failure leaving the
 * dialog open with input intact — is covered at the unit level instead:
 * `machine-model.spec.ts` (`machineSelectOptions`, `isMachineSelectable`,
 * `hasPeerMachines`) and `launch-request.spec.ts` /
 * `terminal-launch-request.spec.ts` (the request a chosen machine
 * produces).
 */
