/**
 * Scoped pairing through the CLI, two nodes in one process, driven through
 * `run()`: A serves with `--grant msg`, B pairs over the URL that grants
 * it, and B's `beam exec` on A is refused while B's `beam msg send` to A
 * over the very same endpoint is delivered.
 *
 * The delivered message is the control. A test that only checked that
 * `exec` failed would pass just as well if A were unreachable, which is
 * the one way this file could prove nothing.
 *
 * As in `e2e.spec.ts`, B's endpoint for A is set directly through the peer
 * table: `serve` deliberately never advertises a loopback address, and
 * both "machines" here are loopback in one process.
 */
import { rmSync } from 'node:fs';
import { PeerTable } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './run.js';
import {
  makeFakeIo,
  makeFakeIoWithBeamDir,
  type FakeIo,
} from './test-support/fake-io.js';

let aIo: FakeIo;
let aDir: string;
let aController: AbortController;
let bDir: string;
let bEnv: Record<string, string | undefined>;
/** Whether this test got as far as starting A's node. The teardown below
 * waits for `serve`'s own exit, which never comes if nothing ever bound. */
let aServing = false;

beforeEach(() => {
  ({ io: aIo, beamDir: aDir } = makeFakeIoWithBeamDir('beam-scope-a-'));
  ({ beamDir: bDir } = makeFakeIoWithBeamDir('beam-scope-b-'));
  bEnv = { BEAM_CONFIG_DIR: bDir };
  aController = new AbortController();
  aIo.signal = aController.signal;
  aServing = false;
});

afterEach(async () => {
  if (aServing) {
    const closed = new Promise<void>((resolve) => {
      aIo.exit = () => resolve();
    });
    aController.abort();
    await closed;
  }
  rmSync(aDir, { recursive: true, force: true });
  rmSync(bDir, { recursive: true, force: true });
});

/** A serves granting `grant` (all three when omitted), B pairs over the
 * URL, and B learns where to dial A back. */
async function serveAndPair(
  grant?: string
): Promise<{ aPeerId: string; pairOut: string }> {
  const args = ['serve', '--port', '0', '--label', 'workbox'];
  if (grant) args.push('--grant', grant);
  expect(await run(args, aIo)).toBe(0);
  aServing = true;
  const bound = aIo.stdoutText().match(/bound to (http:\/\/\S+)/)?.[1];
  const pairUrl = aIo.stdoutText().match(/(http:\/\/\S+\/pair#token=\S+)/)?.[1];
  expect(bound).toBeDefined();

  const bIo = makeFakeIo(bEnv);
  expect(await run(['pair', pairUrl as string], bIo)).toBe(0);
  const aPeerId = new PeerTable(bDir).list()[0]?.peerId as string;
  new PeerTable(bDir).setEndpoints(aPeerId, [bound as string]);
  return { aPeerId, pairOut: bIo.stdoutText() };
}

describe('beam CLI: a pairing grants only what it says', () => {
  it('refuses exec on a msg-only pairing, and delivers a message over the same endpoint', async () => {
    expect(aIo.stdoutText()).not.toContain('grants');
    const { aPeerId, pairOut } = await serveAndPair('msg');

    const execIo = makeFakeIo(bEnv);
    const execCode = await run(
      ['exec', aPeerId, '--', 'sh', '-c', 'echo should-not-run'],
      execIo
    );
    expect(execCode).toBe(1);
    expect(execIo.stdoutText()).not.toContain('should-not-run');
    // Names the scope and says who withheld it — not a transport error,
    // and not something a reader would read as "the host is broken".
    expect(execIo.stderrText()).toContain("did not grant 'exec'");

    // The control: A is up, reachable at that endpoint, and serving this
    // peer — over the one stream kind the pairing granted.
    const sendIo = makeFakeIo(bEnv);
    const sendCode = await run(
      ['msg', 'send', aPeerId, '--message', 'still-reachable'],
      sendIo
    );
    expect(sendCode).toBe(0);
    expect(sendIo.stdoutText()).toMatch(/delivered to/);

    // Both machines say so in their own words.
    expect(aIo.stdoutText()).toContain('pairing URL (grants msg;');
    expect(pairOut).toContain('granted msg there');
  });

  it('runs that same exec when the pairing granted it, so the refusal above is the grant and not the command', async () => {
    const { aPeerId } = await serveAndPair();
    expect(aIo.stdoutText()).toContain('pairing URL (grants pty, exec, msg;');

    const execIo = makeFakeIo(bEnv);
    const execCode = await run(
      ['exec', aPeerId, '--', 'sh', '-c', 'echo it-ran'],
      execIo
    );
    expect(execCode).toBe(0);
    expect(execIo.stdoutText()).toContain('it-ran');
  });

  it('shows what each peer may open here in peers, and in --json', async () => {
    await serveAndPair('msg');

    const tableIo = makeFakeIo(aIo.env);
    expect(await run(['peers'], tableIo)).toBe(0);
    expect(tableIo.stdoutText()).toContain('GRANTS');
    expect(tableIo.stdoutLines().at(-1)).toMatch(/\bmsg\b/);

    const jsonIo = makeFakeIo(aIo.env);
    expect(await run(['peers', '--json'], jsonIo)).toBe(0);
    const rows = JSON.parse(jsonIo.stdoutText()) as { scopes: string[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scopes).toEqual(['msg']);
  });

  it('rejects a grant it does not understand as a usage error, before anything is served', async () => {
    const io = makeFakeIo({ BEAM_CONFIG_DIR: bDir });
    expect(await run(['serve', '--port', '0', '--grant', 'sudo'], io)).toBe(2);
    expect(io.stderrText()).toContain('--grant does not know "sudo"');
    expect(io.stdoutText()).not.toContain('bound to');
  });
});
