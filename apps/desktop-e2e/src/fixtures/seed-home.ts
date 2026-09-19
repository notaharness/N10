import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fakeGhProjectConfig,
  installFakeGh,
  type FakeGitHub,
} from '../setup/fake-gh.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
} from '../setup/external.js';
import {
  startSurvivingTerminal,
  type TerminalSeed,
} from '../setup/terminals.js';
import { seedPeerTable, type PeerSeed } from '../setup/beam-peer.js';
import { seedIdentity } from '../setup/beam-identity.js';

/**
 * Everything a test wants already on disk (or already running) when the
 * app comes up. Split out of `desktop.ts` because it is the part that
 * grows: one more thing to seed is one more branch here, while the
 * fixture itself is about launching and tearing down the app.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(HERE, 'fake-agent.mjs');

/**
 * `aiCommand` that spawns the fake agent.
 *
 *   fakeAgent()                 → alive but idle (no output after the banner)
 *   fakeAgent({ stream: true }) → continuously producing output
 */
export function fakeAgent(
  opts: {
    stream?: boolean;
    intervalMs?: number;
    exitAfterMs?: number;
    /** Echo stdin back, for testing the input round trip. */
    echo?: boolean;
    /** Stop streaming after this long, but stay alive. */
    streamMs?: number;
    /** Print the seed prompt the launcher handed it, `seed:`-prefixed. */
    printSeed?: boolean;
    /** Print the PTY grid as `size:<cols>x<rows>`, and again on resize. */
    printSize?: boolean;
  } = {}
): string {
  const flags = [`--banner=n10-fake-agent-ready`];
  if (opts.stream) flags.push('--stream');
  if (opts.echo) flags.push('--echo');
  if (opts.printSeed) flags.push('--print-seed');
  if (opts.printSize) flags.push('--print-size');
  if (opts.streamMs != null) flags.push(`--stream-ms=${opts.streamMs}`);
  if (opts.intervalMs != null) flags.push(`--interval-ms=${opts.intervalMs}`);
  if (opts.exitAfterMs != null)
    flags.push(`--exit-after-ms=${opts.exitAfterMs}`);
  return ['node', FAKE_AGENT, ...flags].join(' ');
}

/** The seeding half of `DesktopOptions` — everything `seedHome` writes.
 *  `DesktopOptions` extends this, so the two never drift. */
export interface HomeSeed {
  /** Config layered over the fake agent in the isolated HOME. */
  n10Config?: Record<string, unknown>;
  /**
   * Per-project config (vendor, org, repo…), written to the cwd-hashed
   * path the config store reads it from. Needed for anything gated on a
   * configured provider — the settings page only lists a provider's
   * auth fields once one is selected.
   */
  projectConfig?: Record<string, unknown>;
  /** Written to $HOME/.n10/desktop-prefs.json before launch. */
  desktopPrefs?: Record<string, unknown>;
  /**
   * Agent-authored draft review comments, keyed by pull request id, as
   * `n10 util add-comment` would have left them.
   */
  drafts?: Record<number, unknown[]>;
  /**
   * Serve the app a pull request (and its review threads) from a fake
   * `gh` on PATH, with the matching project config written for it.
   * Lets the whole review workspace be driven offline; ignored when
   * `githubToken` is set, which is the real thing.
   */
  fakeGitHub?: FakeGitHub;
  /**
   * Paired-machine rows already in the peer table when the app starts —
   * written straight to the isolated HOME's `$BEAM_DIR/peers.json`
   * before launch, exactly as a real pairing would have left it (see
   * `setup/beam-peer.ts`). Covers the D6 states a live second machine
   * cannot honestly produce in this fixture (`unreachable`,
   * `no-endpoint`, `revoked`); pairing with a real `startPeerHost()` for
   * `reachable` happens live, inside the test.
   */
  beamPeers?: PeerSeed[];
}

/**
 * Write the isolated `$HOME` a test runs against: global config, the
 * per-project config (cwd-hashed, as the config store keys it), any
 * agent-authored drafts, desktop prefs, this machine's beam identity,
 * and — when a scenario is given — the fake `gh`. Returns the
 * environment additions the app needs.
 */
export function seedHome(
  homeDir: string,
  repoPath: string,
  opts: HomeSeed
): Record<string, string> {
  const n10 = join(homeDir, '.n10');
  mkdirSync(n10, { recursive: true });
  // A terminal tab runs the developer's login shell in this home. zsh
  // greets a home with no rc file with its first-user wizard, which
  // swallows whatever a test types next; an empty one means "configured,
  // nothing to do" and the shell comes up at a prompt.
  writeFileSync(join(homeDir, '.zshrc'), '', 'utf8');
  writeFileSync(
    join(n10, 'config.json'),
    JSON.stringify({ aiCommand: fakeAgent(), ...opts.n10Config }, null, 2),
    'utf8'
  );

  seedProjectConfig(n10, repoPath, opts);
  seedDrafts(n10, opts.drafts);

  // Unconditional: this machine's label and fingerprint are rendered in
  // every machines surface, and an identity the app generates for itself
  // makes both random per run — see `setup/beam-identity.ts`.
  seedIdentity(homeDir);
  if (opts.beamPeers) seedPeerTable(homeDir, opts.beamPeers);

  if (opts.desktopPrefs) {
    writeFileSync(
      join(n10, 'desktop-prefs.json'),
      JSON.stringify(opts.desktopPrefs, null, 2),
      'utf8'
    );
  }

  return opts.fakeGitHub ? installFakeGh(homeDir, opts.fakeGitHub) : {};
}

function seedProjectConfig(
  n10: string,
  repoPath: string,
  opts: Pick<HomeSeed, 'projectConfig' | 'fakeGitHub'>
): void {
  const projectConfig =
    opts.projectConfig ??
    (opts.fakeGitHub ? fakeGhProjectConfig(opts.fakeGitHub) : undefined);
  if (!projectConfig) return;
  // Per-project config lives under a hash of the repo path — see
  // projectKey() in @n10/vcs-core's config store.
  const key = createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
  const dir = join(n10, 'projects', key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify(projectConfig, null, 2),
    'utf8'
  );
}

function seedDrafts(
  n10: string,
  drafts: Record<number, unknown[]> | undefined
): void {
  for (const [prId, comments] of Object.entries(drafts ?? {})) {
    // Same layout the review agent writes to: ~/.n10/reviews/pr-<id>.
    const dir = join(n10, 'reviews', `pr-${prId}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'comments.json'),
      JSON.stringify({ prId: Number(prId), comments }, null, 2),
      'utf8'
    );
  }
}

/** Start the agents and terminal tabs a test wants already running when
 *  the app comes up — agents in the test's repository, or in another one
 *  a test names; terminals wherever they say. */
export function seedTmux(
  repoPath: string,
  homeDir: string,
  sessions: { branch: string; command: string; repo?: string }[] | undefined,
  terminals: Record<string, TerminalSeed> | undefined
): void {
  for (const { branch, command, repo = repoPath } of sessions ?? []) {
    startExternalTmuxSession({
      repoPath: repo,
      homeDir,
      branch,
      worktreePath: addExternalWorktree(repo, branch),
      command,
    });
  }
  for (const [name, t] of Object.entries(terminals ?? {})) {
    startSurvivingTerminal({ name, ...t, homeDir });
  }
}
