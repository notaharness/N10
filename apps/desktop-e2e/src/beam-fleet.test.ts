import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  tab,
  visibleText,
} from './setup/app.js';
import {
  BEAM_TEST_BINARY,
  startMachine,
  startTestkit,
  type BeamMachine,
  type Testkit,
} from './setup/beam-testkit.js';
import { leaveFleet, openFleet } from './setup/machines.js';
import { findN10SessionFor } from './setup/tmux.js';

/** `laptop` is the daemon in the fixture HOME, which the app finds;
 *  `workbox` is another machine with a HOME of its own. */
const test = base.extend<{
  kit: Testkit;
  laptop: BeamMachine;
  workbox: BeamMachine;
}>({
  kit: async ({ fixtureHome }, provide) => {
    const kit = await startTestkit(fixtureHome);
    await provide(kit);
    await kit.stop();
  },
  laptop: async ({ fixtureHome, kit }, provide) => {
    const laptop = await startMachine(fixtureHome, kit);
    await provide(laptop);
    await laptop.stop();
  },
  workbox: async ({ fixtureHome, kit }, provide) => {
    const workbox = await startMachine(join(fixtureHome, 'workbox'), kit);
    await provide(workbox);
    await workbox.stop();
  },
  desktop: async ({ laptop, desktop }, provide) => {
    void laptop; // running first, so the app uses it rather than spawning one
    await provide(desktop);
  },
});

/** Creates the fleet from Fleet, joins `workbox` to it with the CLI,
 *  and waits for the app to show workbox connected. */
async function formFleet(page: Page, workbox: BeamMachine): Promise<void> {
  await openFleet({ page });
  await page.getByLabel("This machine's name").fill('laptop');
  await page.getByLabel('Fleet name (to create one)').fill('home');
  await page.getByRole('button', { name: 'Create a fleet' }).click();
  await expect(page.getByText(/^Created fleet/)).toBeVisible({
    timeout: 60_000,
  });

  const joined = await workbox.cli(['join', '--label', 'workbox']);
  expect(joined.code, joined.stderr).toBe(0);
  const rows = page.getByTestId('machine-row');
  await expect(
    rows.filter({ hasText: 'workbox' }).getByText('Connected')
  ).toBeVisible({ timeout: 60_000 });
  await expect(rows).toHaveCount(2);
  await leaveFleet(page);
}

const BRANCH = 'agent-work';

/** Launches the fake agent in a new worktree; its tmux name. */
async function startAgent(page: Page, fixtureHome: string): Promise<string> {
  await createWorktree(page, BRANCH);
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  return findN10SessionFor(BRANCH, fixtureHome)!;
}

/** Sends workbox's Orchestra report to the agent `agent` on laptop. */
async function report(
  workbox: BeamMachine,
  laptop: BeamMachine,
  agent: string
): Promise<void> {
  const sent = await workbox.cli([
    'msg',
    'send',
    await laptop.peerId(),
    '--topic',
    'orchestra',
    `target: tmux:${agent}\n\nDONE from workbox`,
  ]);
  expect(sent.code, sent.stderr).toBe(0);
}

test.describe('A fleet of real beam daemons @beam', () => {
  test.skip(!BEAM_TEST_BINARY, 'needs a beamtest build: nx e2e:beam');
  // Two daemons, two ceremonies and a tunnel on top of the app's launch.
  test.slow();
  test.use({ n10Config: { aiCommand: fakeAgent({ echo: true }) } });

  test('a member’s report is typed into the agent it names', async ({
    desktop,
    laptop,
    workbox,
    fixtureHome,
  }) => {
    await formFleet(desktop.page, workbox);
    const agent = await startAgent(desktop.page, fixtureHome);

    await report(workbox, laptop, agent);
    await expect(
      visibleText(desktop.page, /echo:DONE from workbox/)
    ).toBeVisible({ timeout: 30_000 });
  });

  test('a member granted only mail has its report refused, naming the grant', async ({
    desktop,
    laptop,
    workbox,
    fixtureHome,
  }) => {
    const { page } = desktop;
    await formFleet(desktop.page, workbox);
    const granted = await laptop.cli([
      'peer',
      'grant',
      await workbox.peerId(),
      'msg',
    ]);
    expect(granted.code, granted.stderr).toBe(0);
    const agent = await startAgent(page, fixtureHome);

    await report(workbox, laptop, agent);
    await openFleet(desktop);
    await expect(
      page.getByText(/Refused for tmux:.*grants the sender "msg"/)
    ).toBeVisible({ timeout: 30_000 });
    await leaveFleet(page);
    await tab(page, new RegExp(BRANCH)).click();
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    await expect(visibleText(page, /echo:DONE/)).toHaveCount(0);
  });
});
