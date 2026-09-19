import { test, expect } from './fixtures/desktop.js';
import { openPalette, sidebarRow, tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import { openNewTerminalDialog } from './setup/terminals.js';
import {
  machineRows,
  machinesNavButton,
  openMachinesSettings,
  pairWithUrl,
} from './setup/machines.js';
import {
  peerHostFingerprint,
  startPeerHost,
  UNREACHABLE_ENDPOINT,
} from './setup/beam-peer.js';
import {
  LOCAL_MACHINE_FINGERPRINT,
  LOCAL_MACHINE_LABEL,
} from './setup/beam-identity.js';

/**
 * Phase 4: the machines panel, and the app around it.
 *
 * Three guards. The empty state offers both pairing directions, so a
 * first-time user is never stuck. Pairing itself works end to end
 * against a real second beam `Host` — the one machines flow that has to
 * cross the wire to mean anything. And — the regression an existing
 * user would actually notice — the workspace chrome is unchanged when
 * only the local machine is registered (D8), with the peer-registered
 * case asserted alongside it so each absence guard has something that
 * proves its locator still matches. State derivation and
 * revoke/forget stay at the unit level in apps/desktop.
 */

test.describe('Machines — empty state', () => {
  test('Settings -> Machines offers both directions and shows the local machine', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await machinesNavButton(page).click();

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
    // confirm, so both are asserted as text rather than as presence.
    // The fixture seeds `identity.json`, so this is the machine's real
    // identity as the app loaded it (see `setup/beam-identity.ts`).
    await expect(page.getByText('You', { exact: true })).toBeVisible();
    await expect(page.getByText(LOCAL_MACHINE_LABEL)).toBeVisible();
    await expect(page.getByText(LOCAL_MACHINE_FINGERPRINT)).toBeVisible();
  });

  test('the Add a machine dialog names what is wrong with an unusable URL', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await machinesNavButton(page).click();
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

  // The other half of that dialog: paste, preview, confirm, against a
  // real `Host` from `@n10/beam` speaking the actual descriptor and
  // `/pair` wire protocol on a loopback port. Everything the confirm
  // screen exists to show — the machine's label and the fingerprint a
  // user is asked to compare out of band — is asserted by value, which
  // `startPeerHost` makes possible by deriving its keypair from its
  // label.
  test('pairing through the dialog previews the machine, then registers it', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const peerHost = await startPeerHost('workbox');
    try {
      await openMachinesSettings(app, page);
      await expect(machineRows(page)).toHaveCount(1);

      await pairWithUrl(page, peerHost.pairingUrl(), async (dialog) => {
        await expect(dialog.getByText('workbox')).toBeVisible();
        await expect(
          dialog.getByText(peerHostFingerprint('workbox'))
        ).toBeVisible();
      });

      // The panel now lists this machine and the one just paired, and
      // the footer's machines segment — hidden until a peer exists
      // (D8) — counts both.
      await expect(machineRows(page)).toHaveCount(2);
      await expect(page.getByText('workbox')).toBeVisible();
      await expect(
        page.locator('footer').getByText('2 machines')
      ).toBeVisible();
    } finally {
      await peerHost.close();
    }
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

    // And the machines panel itself lists this machine and nothing
    // else. The empty-state test above asserts the "You" badge is
    // present, which is a claim about the local row; this is the claim
    // that matters to an existing user — that no other row exists.
    // Counting the per-row actions menu means a leaked peer row fails
    // here, and so does a local row that stopped rendering.
    await openMachinesSettings(desktop.app, page);
    await expect(machineRows(page)).toHaveCount(1);
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

// The positive control for D8's footer guard: the same `footer` +
// /machine/i locator that must find nothing above has to find something
// here, or a segment renamed out of its reach would make that guard
// permanently true.
test.describe('Machines — the workspace with a peer registered', () => {
  test.use({
    beamPeers: [
      {
        peerId: 'a1b2c3d4e5f60001',
        label: 'stale-laptop',
        endpoints: [UNREACHABLE_ENDPOINT],
      },
    ],
  });

  test('the status bar counts the machines once one is paired', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const statusBar = page.locator('footer');
    await expect(statusBar.getByText(/machine/i)).toHaveCount(1);
    await expect(
      statusBar.getByText('2 machines · 1 unreachable')
    ).toBeVisible();
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

    // The tab's accessible name is exactly the branch title, with no
    // "<machine> · " prefix at all — an exact match, not a substring
    // one, so a regression that adds a prefix (in any wording, not
    // just today's "·" separator) fails this rather than passing
    // because the branch name still appears somewhere in a longer
    // label. `data-testid="machine-badge"` on the row similarly names
    // what is being asserted absent, rather than a CSS class that
    // would silently stop matching if the badge were restyled.
    await expect(tab(page, 'd8-worktree Close tab', true)).toBeVisible();
    await expect(row.getByTestId('machine-badge')).toHaveCount(0);
  });
});

/**
 * What is NOT covered here, and why: actually *launching* on a
 * registered peer — the other half of ux-machines.md §5. `startPeerHost`
 * answers descriptor and `/pair` requests, which is enough to pair with
 * and to probe, but not to run anything: that needs the full `dial()`
 * mutual-auth handshake and a live pty stream on the far side. Faking
 * it at the IPC layer would prove the mock, not the feature. Which
 * options that `Select` enables or disables and why, the step progress,
 * and a failure leaving the dialog open with input intact are covered
 * at the unit level instead: `machine-model.spec.ts`
 * (`machineSelectOptions`, `isMachineSelectable`, `hasPeerMachines`)
 * and `launch-request.spec.ts` / `terminal-launch-request.spec.ts` (the
 * request a chosen machine produces).
 *
 * The sidebar's `machine-badge` and a tab's `<machine> · ` prefix are
 * asserted absent above with no positive control, for the same reason:
 * `resolveMachineLabel` returns null for a local session, so both need
 * a session actually running on a remote machine to appear at all.
 */
