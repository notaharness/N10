/**
 * `beam serve [--port N] [--hostname ADDR] [--label NAME] [--no-pair]` (D9).
 *
 * Returns once the node is fully bound and listening — the process then
 * stays alive because of the open server sockets, not because this
 * function is still running. Real usage lives until SIGINT/SIGTERM; a test
 * can end it early with `io.signal`.
 */

import { parseArgs } from '../args.js';
import type { Io } from '../io.js';
import { startNode } from '../node.js';
import { UsageError } from '../usage.js';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);
const WILDCARD_HOSTNAMES = new Set(['0.0.0.0', '::']);

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

export async function runServe(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, {
    valueFlags: ['port', 'hostname', 'label'],
    booleanFlags: ['no-pair'],
  });
  const hostname = parsed.values.get('hostname') ?? '127.0.0.1';
  const explicitPort = parsePort(parsed.values.get('port'));
  const label = parsed.values.get('label');

  const handle = await startNode(io, {
    hostname,
    port: explicitPort,
    label,
    endpoints: computeEndpoints(hostname, explicitPort),
    log: (message) => io.stderr.write(`[beam] ${message}\n`),
  });

  if (label && handle.identity.label !== label) {
    io.stderr.write(
      `note: this machine is already known as "${handle.identity.label}" — ` +
        `--label only sets the name the first time a node runs here.\n`
    );
  }

  io.stdout.write(
    `${handle.identity.label} (${handle.identity.peerId}) bound to http://${handle.host.hostname}:${handle.host.port}\n`
  );
  if (!LOOPBACK_HOSTNAMES.has(handle.host.hostname)) {
    io.stdout.write(
      `warning: bound beyond loopback — anything on ${handle.host.hostname} that can reach this ` +
        `address and obtains the pairing URL below gets a shell as this user.\n`
    );
  }

  let closing: Promise<void> | undefined;
  const shutdown = (): void => {
    if (closing) return;
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    closing = handle.close();
    void closing.then(() => io.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  io.signal?.addEventListener('abort', shutdown, { once: true });

  if (!parsed.booleans.has('no-pair')) {
    const { url } = handle.host.issuePairingUrl();
    // Printed last (docs/beam.md, and this brief): it is the line a person
    // copies, so it is the line left on screen after everything else.
    io.stdout.write(
      `pairing URL (share with the machine you are pairing, valid 10 minutes):\n${url}\n`
    );
  }

  return 0;
}
