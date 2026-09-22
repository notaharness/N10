/**
 * Never shells out to a real `tailscale`: every case here drives the
 * injected `CommandRunner`, so the argv built for each case and each named
 * failure mode are asserted on a machine that may have no tailscale at all.
 */

import { describe, expect, it } from 'vitest';
import {
  startTailscaleServe,
  type CommandOutcome,
  type CommandRunner,
} from './tailscale.js';
import { RuntimeError } from './usage.js';

function ok(stdout = ''): CommandOutcome {
  return { code: 0, stdout, stderr: '', timedOut: false };
}

const RUNNING_STATUS = JSON.stringify({
  BackendState: 'Running',
  CertDomains: ['doppa.tail3a5828.ts.net'],
  Self: { DNSName: 'doppa.tail3a5828.ts.net.' },
});

interface Recorded {
  argv: string[];
  timeoutMs: number;
}

/** A runner over a queue of scripted replies keyed by the first two argv
 * words after `tailscale`, recording every call for argv assertions. */
function scriptedRunner(
  replies: Record<string, CommandOutcome | (() => CommandOutcome)>,
  calls: Recorded[] = []
): CommandRunner & { calls: Recorded[] } {
  const run = (argv: string[], timeoutMs: number): Promise<CommandOutcome> => {
    calls.push({ argv, timeoutMs });
    const key = argv.slice(1, 3).join(' ');
    const reply = replies[key] ?? replies['*'];
    if (reply === undefined)
      throw new Error(`no scripted reply for: ${argv.join(' ')}`);
    return Promise.resolve(typeof reply === 'function' ? reply() : reply);
  };
  return Object.assign(run, { calls });
}

const HEALTHY = {
  'status --json': ok(RUNNING_STATUS),
  'serve status': ok('{}'),
  'serve --bg': ok(''),
};

async function expectRuntimeError(
  promise: Promise<unknown>
): Promise<RuntimeError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(RuntimeError);
  return error as RuntimeError;
}

describe('startTailscaleServe argv', () => {
  it('brings the mapping up in the background, on 443, pointed at the loopback port', async () => {
    const run = scriptedRunner(HEALTHY);
    const handle = await startTailscaleServe({ run, localPort: 8421 });

    expect(run.calls.map((c) => c.argv)).toEqual([
      ['tailscale', 'status', '--json'],
      ['tailscale', 'serve', 'status', '--json'],
      ['tailscale', 'serve', '--bg', '--https=443', 'http://127.0.0.1:8421'],
    ]);
    expect(handle.dnsName).toBe('doppa.tail3a5828.ts.net');
    expect(handle.origin).toBe('https://doppa.tail3a5828.ts.net');
  });

  it('bounds every invocation, so a serve that blocks cannot hang beam', async () => {
    const run = scriptedRunner(HEALTHY);
    await startTailscaleServe({ run, localPort: 8421 });
    for (const call of run.calls) {
      expect(call.timeoutMs).toBeGreaterThan(0);
      expect(call.timeoutMs).toBeLessThanOrEqual(20_000);
    }
  });

  it('tears the mapping down with the matching off form', async () => {
    const run = scriptedRunner({ ...HEALTHY, 'serve --https=443': ok('') });
    const handle = await startTailscaleServe({ run, localPort: 8421 });
    run.calls.length = 0;

    const logged: string[] = [];
    await handle.stop((m) => logged.push(m));

    expect(run.calls.map((c) => c.argv)).toEqual([
      ['tailscale', 'serve', '--https=443', 'off'],
    ]);
    expect(logged).toEqual([]);
  });

  it('stop is idempotent, so an abort racing a signal does not remove twice', async () => {
    const run = scriptedRunner({ ...HEALTHY, 'serve --https=443': ok('') });
    const handle = await startTailscaleServe({ run, localPort: 8421 });
    run.calls.length = 0;

    await handle.stop(() => undefined);
    await handle.stop(() => undefined);

    expect(run.calls).toHaveLength(1);
  });

  it('reports a failed teardown instead of throwing on the shutdown path', async () => {
    const run = scriptedRunner({
      ...HEALTHY,
      'serve --https=443': {
        code: 1,
        stdout: '',
        stderr: 'error: failed to remove web serve: handler does not exist',
        timedOut: false,
      },
    });
    const handle = await startTailscaleServe({ run, localPort: 8421 });

    const logged: string[] = [];
    await expect(handle.stop((m) => logged.push(m))).resolves.toBeUndefined();
    expect(logged[0]).toContain('tailscale serve --https=443 off');
    expect(logged[0]).toContain('handler does not exist');
  });
});

describe('startTailscaleServe failure modes', () => {
  it('names the missing binary rather than an ENOENT stack', async () => {
    const run = scriptedRunner({
      '*': {
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnErrorCode: 'ENOENT',
      },
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('the tailscale CLI is not on PATH');
    expect(error.message).toContain('https://tailscale.com/download');
  });

  it('reports a logged-out node with the state tailscale reported', async () => {
    const run = scriptedRunner({
      'status --json': ok(JSON.stringify({ BackendState: 'NeedsLogin' })),
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('not connected (state: NeedsLogin)');
    expect(error.message).toContain('tailscale up');
  });

  it('reports a missing MagicDNS name', async () => {
    const run = scriptedRunner({
      'status --json': ok(
        JSON.stringify({
          BackendState: 'Running',
          CertDomains: ['x'],
          Self: { DNSName: '' },
        })
      ),
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('no MagicDNS name');
    expect(error.message).toContain('login.tailscale.com/admin/dns');
  });

  it('reports the tailnet HTTPS toggle before running a serve that would block', async () => {
    const run = scriptedRunner({
      'status --json': ok(
        JSON.stringify({
          BackendState: 'Running',
          CertDomains: [],
          Self: { DNSName: 'doppa.tail3a5828.ts.net.' },
        })
      ),
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('HTTPS certificates are not enabled');
    expect(error.message).toContain('login.tailscale.com/admin/dns');
    // Nothing beyond `status` ran: the point of checking here is to avoid
    // the 20s block `tailscale serve` does when the toggle is off.
    expect(run.calls).toHaveLength(1);
  });

  it('refuses a port already served by something else, naming its target', async () => {
    const run = scriptedRunner({
      ...HEALTHY,
      'serve status': ok(
        JSON.stringify({
          TCP: { '443': { HTTPS: true } },
          Web: {
            'doppa.tail3a5828.ts.net:443': {
              Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
            },
          },
        })
      ),
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('already serves port 443');
    expect(error.message).toContain('http://127.0.0.1:3000');
    expect(error.message).toContain('tailscale serve --https=443 off');
    expect(run.calls).toHaveLength(2);
  });

  it('refuses a served port it cannot read a target for', async () => {
    const run = scriptedRunner({
      ...HEALTHY,
      'serve status': ok(JSON.stringify({ TCP: { '443': { HTTPS: true } } })),
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('already serves port 443');
    expect(error.message).not.toContain('->');
  });

  it('adopts a leftover mapping that already points at this exact port', async () => {
    const run = scriptedRunner({
      ...HEALTHY,
      'serve status': ok(
        JSON.stringify({
          TCP: { '443': { HTTPS: true } },
          Web: {
            'doppa.tail3a5828.ts.net:443': {
              Handlers: { '/': { Proxy: 'http://127.0.0.1:8421' } },
            },
          },
        })
      ),
    });
    const handle = await startTailscaleServe({ run, localPort: 8421 });

    expect(handle.origin).toBe('https://doppa.tail3a5828.ts.net');
    // No `serve --bg`: the mapping already says what this one would.
    expect(run.calls).toHaveLength(2);
  });

  it('explains a serve that blocked rather than failing', async () => {
    const run = scriptedRunner({
      ...HEALTHY,
      'serve --bg': {
        code: null,
        stdout: 'Serve is not enabled on your tailnet.',
        stderr: '',
        timedOut: true,
      },
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('did not finish within 20s');
    expect(error.message).toContain('blocks rather than failing');
  });

  it('surfaces a serve that exited non-zero with its own first line', async () => {
    const run = scriptedRunner({
      ...HEALTHY,
      'serve --bg': {
        code: 1,
        stdout: '',
        stderr: 'error: invalid port\n\ntry `tailscale serve --help`',
        timedOut: false,
      },
    });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('failed (exit 1)');
    expect(error.message).toContain('error: invalid port');
  });

  it('reports unparseable status output rather than throwing a SyntaxError', async () => {
    const run = scriptedRunner({ 'status --json': ok('not json') });
    const error = await expectRuntimeError(
      startTailscaleServe({ run, localPort: 8421 })
    );
    expect(error.message).toContain('could not parse');
  });
});
