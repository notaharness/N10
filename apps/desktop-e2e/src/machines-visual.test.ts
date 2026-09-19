import { test, expect } from './fixtures/desktop.js';
import { createWorktree, sidebarRow } from './setup/app.js';
import { openNewTerminalDialog } from './setup/terminals.js';
import {
  openAddMachineDialog,
  openMachinesSettings,
  pairWithUrl,
  previewPairingUrl,
  PEER_ENDPOINT_TEXT,
} from './setup/machines.js';
import {
  peerHostFingerprint,
  startPeerHost,
  UNREACHABLE_ENDPOINT,
  type PeerSeed,
} from './setup/beam-peer.js';
import { shot } from './setup/visual.js';

/**
 * The machines feature added a lot of UI with no visual coverage — see
 * `docs/testing.md`'s `@visual` paragraph for how these states are
 * reached (a seeded peer table plus a real second `Host` for the
 * `reachable` row, never a mock of the machines UI itself).
 *
 * Not covered here, and why: a live `connected` transport, a remote
 * session's connection banner, and its tab/sidebar badges all need a
 * genuinely running remote session — the full `dial()` mutual-auth
 * handshake plus a real pty stream, not just a descriptor/pairing
 * response. `machines.test.ts`'s closing comment already draws this
 * same line for the *selector's* enabled state; it applies more so to
 * actually running something over it. Faking that at the IPC layer
 * would screenshot a mock, not the feature. The inbound-mail panel
 * (waiting/refused) is skippable for the same reason one layer down:
 * a "waiting" row needs a real envelope replayed through the live
 * mailbox relay against a session already in a specific retained state,
 * not a file dropped on disk before launch.
 */

const UNREACHABLE_PEER: PeerSeed = {
  peerId: 'a1b2c3d4e5f60001',
  label: 'stale-laptop',
  endpoints: [UNREACHABLE_ENDPOINT],
};
const NO_ENDPOINT_PEER: PeerSeed = {
  peerId: 'a1b2c3d4e5f60002',
  label: 'phone',
  queued: 2,
};
const REVOKED_PEER: PeerSeed = {
  peerId: 'a1b2c3d4e5f60003',
  label: 'old-workstation',
  revoked: true,
};

test.describe('Machines visual @visual', () => {
  test.use({ repo: { name: 'n10-visual-machines' } });

  test.describe('peer table states', () => {
    test.use({
      beamPeers: [UNREACHABLE_PEER, NO_ENDPOINT_PEER, REVOKED_PEER],
    });

    test('settings machines panel with a peer in every D6 state', async ({
      desktop,
    }) => {
      const { app, page } = desktop;
      const peerHost = await startPeerHost('workbox');
      try {
        await openMachinesSettings(app, page);

        // The seeded rows' probes resolve at BeamNode startup (an empty
        // endpoint list needs none; a closed local port fails fast) —
        // wait for what they settle into rather than a fixed delay.
        await expect(page.getByText('Unreachable')).toBeVisible();
        await expect(page.getByText('Can reach us only')).toBeVisible();
        // `exact` — the row's own secondary text is the literal
        // `revoked` (machine-model.ts's `secondaryText` with no
        // `revokedAt`), a second case-insensitive substring match.
        await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
        await expect(page.getByText('2 waiting')).toBeVisible();

        // The fifth state — `reachable` — only exists once something
        // real answers a probe, so it is paired live rather than seeded.
        await pairWithUrl(page, peerHost.pairingUrl());

        // The paired row's secondary text is `machine.endpoints[0]` —
        // a loopback URL on an OS-assigned port, the only part of this
        // panel that is not fixed.
        const endpoint = page.getByText(PEER_ENDPOINT_TEXT);
        await expect(endpoint).toBeVisible();
        await expect(page).toHaveScreenshot('settings-machines-peers.png', {
          ...shot,
          mask: [endpoint],
        });
      } finally {
        await peerHost.close();
      }
    });
  });

  test('add a machine — the fingerprint confirm before anything is stored', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const peerHost = await startPeerHost('workbox');
    try {
      await openMachinesSettings(app, page);
      const dialog = await openAddMachineDialog(page);
      await previewPairingUrl(dialog, peerHost.pairingUrl());

      await expect(dialog.getByText('workbox')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Pair' })).toBeVisible();
      // The fingerprint is the whole point of this screen, and
      // `startPeerHost` derives its keypair from the label, so the
      // exact text it must show is known rather than merely stable.
      await expect(
        dialog.getByText(peerHostFingerprint('workbox'))
      ).toBeVisible();

      const endpoint = dialog.getByText(PEER_ENDPOINT_TEXT);
      await expect(endpoint).toBeVisible();
      await expect(dialog).toHaveScreenshot('dialog-pair-machine-confirm.png', {
        ...shot,
        mask: [endpoint],
      });
    } finally {
      await peerHost.close();
    }
  });

  test('accept connections: the pairing URL and countdown', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openMachinesSettings(app, page);
    await page.getByRole('switch', { name: 'Accept connections' }).click();

    const boundTo = page.getByText(/^Bound to /);
    const pairingUrl = page.getByText(/^http:\/\//);
    const countdown = page.getByText(/^expires in \d/);
    await expect(boundTo).toBeVisible();
    await expect(pairingUrl).toBeVisible();
    await expect(countdown).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

    // The bound port, the pairing token and the countdown are freshly
    // random every run — masked rather than pinned, since nothing here
    // exposes a fixed port or a seeded clock. Each is asserted visible
    // above: a mask whose locator stops matching silently stops
    // applying, and a random port then lands in the baseline as an
    // intermittent pixel diff instead of a clear failure. What is left unmasked
    // (the switch, the panel layout, the copy button, what pairing
    // grants) is exactly what a regression would actually break.
    await expect(page).toHaveScreenshot('settings-machines-accepting.png', {
      ...shot,
      mask: [boundTo, pairingUrl, countdown],
    });
  });

  test.describe('launch surfaces with a paired machine', () => {
    test.use({ beamPeers: [UNREACHABLE_PEER] });

    test('new terminal dialog offers the reachable machine and shows why the other is disabled', async ({
      desktop,
    }) => {
      const { app, page } = desktop;
      const peerHost = await startPeerHost('workbox');
      try {
        await openMachinesSettings(app, page);
        await pairWithUrl(page, peerHost.pairingUrl());

        const dialog = await openNewTerminalDialog(app, page);
        await dialog.getByRole('combobox', { name: 'Machine' }).click();
        await expect(
          page.getByRole('option', { name: /workbox/ })
        ).toBeVisible();
        await expect(
          page.getByRole('option', { name: /stale-laptop.*Unreachable/ })
        ).toBeVisible();

        // The Select's popover portals to <body>, outside the dialog —
        // the full page is what actually shows both rows, and that
        // includes the machines panel (and its paired row's ephemeral
        // endpoint) behind the dialog.
        const endpoint = page.getByText(PEER_ENDPOINT_TEXT);
        await expect(endpoint).toBeVisible();
        await expect(page).toHaveScreenshot(
          'dialog-new-terminal-machine-select.png',
          { ...shot, mask: [endpoint] }
        );
      } finally {
        await peerHost.close();
      }
    });

    test('agent launch dialog offers the reachable machine and shows why the other is disabled', async ({
      desktop,
    }) => {
      const { app, page } = desktop;
      const peerHost = await startPeerHost('workbox');
      try {
        await openMachinesSettings(app, page);
        await pairWithUrl(page, peerHost.pairingUrl());

        await createWorktree(page, 'visual-machine-launch');
        await sidebarRow(page, /visual-machine-launch/)
          .first()
          .click();
        await page
          .getByRole('button', {
            name: /^(Launch|Relaunch) agent$/,
            exact: true,
          })
          .click();
        const menu = page.locator('[data-launch-dialog]');
        await menu.waitFor({ state: 'visible' });
        await menu.getByRole('combobox', { name: 'Machine' }).click();
        await expect(
          page.getByRole('option', { name: /workbox/ })
        ).toBeVisible();
        await expect(
          page.getByRole('option', { name: /stale-laptop.*Unreachable/ })
        ).toBeVisible();

        // Nothing to mask here, asserted rather than assumed: creating
        // the worktree activated its own tab, and `EditorArea` unmounts
        // an inactive pane with no session — so the machines panel (and
        // the paired row's ephemeral port) is gone from the page, and a
        // change that kept it mounted would silently reintroduce a
        // random port into this baseline.
        await expect(page.getByText(PEER_ENDPOINT_TEXT)).toHaveCount(0);
        await expect(page).toHaveScreenshot(
          'dialog-launch-agent-machine-select.png',
          shot
        );
      } finally {
        await peerHost.close();
      }
    });
  });

  // D8's absent half, in pixels. `machines.test.ts` already asserts the
  // control has count 0 on both surfaces; these are the same two
  // dialogs a user who paired nothing sees, so a machine row, a
  // widened layout or a shifted footer creeping in shows up here as a
  // diff rather than as a passing count-0 assertion. Both dialogs are
  // otherwise unshot — the regression value is not limited to machines.
  test.describe('no machine paired', () => {
    test.use({
      repo: {
        name: 'n10-visual-local',
        worktrees: [{ branch: 'visual-local' }],
      },
    });

    test('the New terminal dialog carries no machine control', async ({
      desktop,
    }) => {
      const { app, page } = desktop;
      const dialog = await openNewTerminalDialog(app, page);
      await expect(
        dialog.getByRole('combobox', { name: 'Machine' })
      ).toHaveCount(0);
      await expect(dialog).toHaveScreenshot(
        'dialog-new-terminal-local-only.png',
        shot
      );
    });

    test('the agent launch dialog carries no machine control', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await sidebarRow(page, /visual-local/)
        .first()
        .click();
      await page
        .getByRole('button', { name: /^(Launch|Relaunch) agent$/, exact: true })
        .click();
      const menu = page.locator('[data-launch-dialog]');
      await menu.waitFor({ state: 'visible' });
      await expect(menu.getByRole('combobox', { name: 'Machine' })).toHaveCount(
        0
      );
      await expect(menu).toHaveScreenshot(
        'dialog-launch-agent-local-only.png',
        shot
      );
    });
  });
});
