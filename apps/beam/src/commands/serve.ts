/**
 * `beam serve [--port N] [--hostname ADDR] [--label NAME] [--grant LIST]
 * [--no-pair] [--tailscale-serve]` (D9).
 *
 * Returns once the node is fully bound and listening — the process then
 * stays alive because of the open server sockets, not because this
 * function is still running. Real usage lives until SIGINT/SIGTERM; a test
 * can end it early with `io.signal`.
 */

import { isStreamScope, STREAM_SCOPES, type StreamScope } from '@n10/beam';
import { parseArgs } from '../args.js';
import type { Io } from '../io.js';
import { startNode, type NodeHandle } from '../node.js';
import {
  realCommandRunner,
  startTailscaleServe,
  type CommandRunner,
  type TailscaleServeHandle,
} from '../tailscale.js';
import { UsageError } from '../usage.js';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);
const WILDCARD_HOSTNAMES = new Set(['0.0.0.0', '::']);

export interface ServeDeps {
  /** Injected so tests can assert the exact argv handed to `tailscale` and
   * drive every failure mode without one installed. */
  runCommand?: CommandRunner;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(
      `--port must be an integer between 0 and 65535, got: ${value}`
    );
  }
  return port;
}

/** An endpoint is only worth advertising when it is a concrete, dialable
 * address: a specific hostname/IP and a port we already know (i.e. the
 * caller passed `--port` explicitly — an OS-assigned port is only known
 * after `listen()`, too late to hand to `Host`'s constructor, and would
 * change on every restart regardless). Loopback and wildcard hostnames are
 * never useful endpoints for a remote peer. */
function computeEndpoints(
  hostname: string,
  explicitPort: number | undefined
): string[] {
  if (explicitPort === undefined) return [];
  if (LOOPBACK_HOSTNAMES.has(hostname) || WILDCARD_HOSTNAMES.has(hostname))
    return [];
  return [`http://${hostname}:${explicitPort}`];
}

/** `--tailscale-serve` proxies the tailnet's `:443` to this node on
 * loopback, so the node must be on loopback and nowhere else. Accepting
 * both flags would leave the plaintext port listening on the wider
 * interface alongside the TLS one, which is the exact exposure the flag
 * exists to remove. `--hostname` on its own is untouched. */
function requireLoopbackForTailscale(hostname: string | undefined): void {
  if (hostname === undefined || LOOPBACK_HOSTNAMES.has(hostname)) return;
  throw new UsageError(
    `--tailscale-serve binds loopback and publishes it over the tailnet, so it ` +
      `cannot be combined with --hostname ${hostname}, which would leave the ` +
      `unencrypted port listening on that interface too`
  );
}

/**
 * `--grant pty,exec,msg` — what the pairing URL this run prints will let
 * the machine that spends it do here. Omitted grants all three, so a
 * `beam serve` that says nothing about scopes pairs exactly as it always
 * did. This flag is the whole of the CLI's say in the matter, because the
 * grant belongs to the token: a peer never asks for scopes, it is handed
 * them (docs/beam.md).
 */
function parseGrant(value: string | undefined): readonly StreamScope[] {
  if (value === undefined) return STREAM_SCOPES;
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new UsageError(
      `--grant needs at least one of ${STREAM_SCOPES.join(
        ', '
      )}, or omit it to grant all three`
    );
  }
  const scopes: StreamScope[] = [];
  for (const name of names) {
    if (!isStreamScope(name)) {
      throw new UsageError(
        `--grant does not know "${name}"; it takes a comma-separated list of ${STREAM_SCOPES.join(
          ', '
        )}`
      );
    }
    scopes.push(name);
  }
  return scopes;
}

/** Brings the tailnet proxy up now that `listen()` has resolved the real
 * port, and points the node's advertised endpoint at the MagicDNS name so
 * `pair` and every reconnect after it resolve over the tailnet rather than
 * at a loopback address no peer can reach. */
async function publishOverTailscale(
  handle: NodeHandle,
  io: Io,
  run: CommandRunner
): Promise<TailscaleServeHandle> {
  const tailscale = await startTailscaleServe({
    run,
    localPort: handle.host.port,
  });
  handle.host.setEndpoints([tailscale.origin]);
  io.stdout.write(
    `published over tailscale serve: ${tailscale.origin} -> http://127.0.0.1:${handle.host.port} (TLS terminated by tailscale)\n`
  );
  return tailscale;
}

function reportBinding(
  handle: NodeHandle,
  io: Io,
  viaTailscale: boolean,
  granted: readonly StreamScope[]
): void {
  io.stdout.write(
    `${handle.identity.label} (${handle.identity.peerId}) bound to http://${handle.host.hostname}:${handle.host.port}\n`
  );
  if (viaTailscale || LOOPBACK_HOSTNAMES.has(handle.host.hostname)) return;
  // What the URL below is worth to whoever captures it, which is now a
  // question with more than one answer: a `msg`-only grant is not a shell,
  // and calling it one trains a reader to ignore this warning.
  const shell = granted.includes('pty') || granted.includes('exec');
  io.stdout.write(
    `warning: bound beyond loopback — anything on ${handle.host.hostname} that can reach this ` +
      `address and obtains the pairing URL below ` +
      (shell
        ? 'gets a shell as this user.\n'
        : `pairs as a peer granted ${granted.join(', ')}.\n`)
  );
}

function installShutdown(
  handle: NodeHandle,
  io: Io,
  tailscale: TailscaleServeHandle | undefined
): void {
  let closing: Promise<void> | undefined;
  const shutdown = (): void => {
    if (closing) return;
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    // The mapping is torn down before the node stops answering, so the
    // tailnet name never points at a dead port. A crash skips this; the
    // next run detects the leftover rather than overwriting it.
    closing = (
      tailscale?.stop((m) => io.stderr.write(`[beam] ${m}\n`)) ??
      Promise.resolve()
    ).then(() => handle.close());
    void closing.then(() => io.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  io.signal?.addEventListener('abort', shutdown, { once: true });
}

export async function runServe(
  args: string[],
  io: Io,
  deps: ServeDeps = {}
): Promise<number> {
  const parsed = parseArgs(args, {
    valueFlags: ['port', 'hostname', 'label', 'grant'],
    booleanFlags: ['no-pair', 'tailscale-serve'],
  });
  const granted = parseGrant(parsed.values.get('grant'));
  const viaTailscale = parsed.booleans.has('tailscale-serve');
  if (viaTailscale) requireLoopbackForTailscale(parsed.values.get('hostname'));

  const hostname = parsed.values.get('hostname') ?? '127.0.0.1';
  const explicitPort = parsePort(parsed.values.get('port'));

  const handle = await startNode(io, {
    hostname,
    port: explicitPort,
    label: parsed.values.get('label'),
    endpoints: computeEndpoints(hostname, explicitPort),
    log: (message) => io.stderr.write(`[beam] ${message}\n`),
  });

  let tailscale: TailscaleServeHandle | undefined;
  if (viaTailscale) {
    try {
      tailscale = await publishOverTailscale(
        handle,
        io,
        deps.runCommand ?? realCommandRunner
      );
    } catch (error) {
      // The node is already listening; leave nothing behind for the error
      // path the CLI is about to report.
      await handle.close();
      throw error;
    }
  }

  reportBinding(handle, io, viaTailscale, granted);
  installShutdown(handle, io, tailscale);

  if (!parsed.booleans.has('no-pair')) {
    // Over tailscale the URL a person copies must carry the MagicDNS
    // origin, not the host's own loopback bind address: it is the endpoint
    // the pairing peer stores and dials for every later reconnect.
    const token = handle.host.issuePairingToken(granted);
    const url = tailscale
      ? `${tailscale.origin}/pair#token=${token}`
      : `${handle.host.baseUrl}/pair#token=${token}`;
    // Printed last (docs/beam.md, and this brief): it is the line a person
    // copies, so it is the line left on screen after everything else. What
    // it grants goes above it, not after it, for the same reason.
    io.stdout.write(
      `pairing URL (grants ${granted.join(
        ', '
      )}; share with the machine you are pairing, valid 10 minutes):\n${url}\n`
    );
  }

  return 0;
}
