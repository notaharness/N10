/**
 * `beam serve --tailscale-serve`: publish the loopback-bound node through
 * `tailscale serve`, which terminates TLS with the tailnet's MagicDNS
 * certificate. beam's own transport carries no encryption (docs/beam.md,
 * "Security posture"); this is the supported way to put some under it.
 *
 * Everything here goes through an injected `CommandRunner` so the argv this
 * builds, and every failure mode it reports, are testable without a real
 * `tailscale` on the machine running the tests.
 */

import { execFile } from 'node:child_process';
import { RuntimeError } from './usage.js';

/** The tailnet-facing port. Fixed: 443 is what a MagicDNS certificate
 * covers and what `https://<name>/…` resolves to without a port suffix, so
 * there is nothing here for a caller to choose. */
export const TAILSCALE_HTTPS_PORT = 443;

const STATUS_TIMEOUT_MS = 10_000;
/** `tailscale serve` does not fail when the tailnet has serve disabled — it
 * prints an enable link and then blocks, waiting for someone to click it
 * (observed on 1.102.3). A `serve` that never returns would hang `beam
 * serve` before it printed a pairing URL, so every invocation is bounded. */
const SERVE_TIMEOUT_MS = 20_000;

const ADMIN_DNS_URL = 'https://login.tailscale.com/admin/dns';

export interface CommandOutcome {
  /** Exit status, or null when a signal ended the process. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Still running when its budget expired; killed. */
  timedOut: boolean;
  /** The binary could not be executed at all — `ENOENT` when it is not on
   * PATH. Distinct from a non-zero exit, which means it ran and refused. */
  spawnErrorCode?: string;
}

export type CommandRunner = (
  argv: string[],
  timeoutMs: number
) => Promise<CommandOutcome>;

/** Spawns the real binary. `execFile` takes an argv array, so nothing here
 * is ever interpreted by a shell. */
export const realCommandRunner: CommandRunner = (argv, timeoutMs) =>
  new Promise((resolve) => {
    const [command, ...rest] = argv as [string, ...string[]];
    const child = execFile(
      command,
      rest,
      { timeout: timeoutMs, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const err = error as
          | (NodeJS.ErrnoException & { killed?: boolean })
          | null;
        resolve({
          code: child.exitCode,
          stdout,
          stderr,
          timedOut: err?.killed === true && child.exitCode === null,
          spawnErrorCode:
            err?.code !== undefined && typeof err.code === 'string'
              ? err.code
              : undefined,
        });
      }
    );
  });

export interface TailscaleServeHandle {
  /** This node's MagicDNS name, trailing dot stripped. */
  dnsName: string;
  /** `https://<dnsName>` — what peers store as the endpoint and dial. */
  origin: string;
  /** Removes the mapping, whether this call created or adopted it. Never
   * rejects: it runs on the shutdown path, where a failure to tidy up must
   * not mask the shutdown itself. Reports through `log` instead. */
  stop(log: (message: string) => void): Promise<void>;
}

interface SelfStatus {
  DNSName?: unknown;
}

interface TailscaleStatus {
  BackendState?: unknown;
  CertDomains?: unknown;
  Self?: SelfStatus;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RuntimeError(
      `--tailscale-serve: could not parse the output of "tailscale ${what}" as JSON`
    );
  }
}

/** Turns a runner outcome into the one failure every `tailscale` call
 * shares — the binary not being installed — or hands it back untouched. */
function requireTailscaleInstalled(outcome: CommandOutcome): CommandOutcome {
  if (outcome.spawnErrorCode !== 'ENOENT') return outcome;
  throw new RuntimeError(
    '--tailscale-serve: the tailscale CLI is not on PATH — install Tailscale ' +
      '(https://tailscale.com/download), or drop --tailscale-serve and read ' +
      "docs/beam.md's security posture first"
  );
}

interface TailnetIdentity {
  dnsName: string;
}

/** `tailscale status --json`, reduced to the two things that decide whether
 * a serve mapping can work at all: whether the backend is up and logged in,
 * and whether this tailnet has HTTPS certificates enabled. */
function readTailnetIdentity(status: TailscaleStatus): TailnetIdentity {
  const state =
    typeof status.BackendState === 'string' ? status.BackendState : 'unknown';
  if (state !== 'Running') {
    throw new RuntimeError(
      `--tailscale-serve: tailscale is installed but not connected (state: ${state}) — ` +
        'run "tailscale up" and sign in first'
    );
  }

  const raw =
    typeof status.Self?.DNSName === 'string' ? status.Self.DNSName : '';
  const dnsName = raw.replace(/\.$/, '');
  if (dnsName === '') {
    throw new RuntimeError(
      '--tailscale-serve: this node has no MagicDNS name, so there is no hostname ' +
        `for peers to dial — enable MagicDNS for the tailnet at ${ADMIN_DNS_URL}`
    );
  }

  // Populated only once the tailnet has HTTPS certificates turned on, which
  // is the admin toggle `tailscale serve` needs and the one people miss.
  // Checked here rather than left to `serve`, which blocks instead of
  // failing when it is off.
  const certDomains = Array.isArray(status.CertDomains)
    ? status.CertDomains
    : [];
  if (certDomains.length === 0) {
    throw new RuntimeError(
      '--tailscale-serve: HTTPS certificates are not enabled for this tailnet, so ' +
        'tailscale serve has no certificate to terminate TLS with — enable them at ' +
        `${ADMIN_DNS_URL} under "HTTPS Certificates". Running "tailscale serve" by hand ` +
        'prints an enable link scoped to this node.'
    );
  }

  return { dnsName };
}

async function fetchTailnetIdentity(
  run: CommandRunner
): Promise<TailnetIdentity> {
  const outcome = requireTailscaleInstalled(
    await run(['tailscale', 'status', '--json'], STATUS_TIMEOUT_MS)
  );
  if (outcome.timedOut) {
    throw new RuntimeError(
      '--tailscale-serve: "tailscale status --json" did not answer within ' +
        `${STATUS_TIMEOUT_MS / 1000}s — is the tailscaled daemon running?`
    );
  }
  if (outcome.code !== 0) {
    throw new RuntimeError(
      `--tailscale-serve: "tailscale status --json" failed (exit ${outcome.code}): ` +
        `${
          firstLine(outcome.stderr) || firstLine(outcome.stdout) || 'no output'
        }`
    );
  }
  return readTailnetIdentity(
    parseJson(outcome.stdout, 'status --json') as TailscaleStatus
  );
}

/** `value[key]`, when `value` is a plain object and the entry is one too.
 * `tailscale serve status --json` is a nested map whose shape has moved
 * across releases, so every level is narrowed rather than asserted. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** The first proxy target configured under the `:port` web handler, or `''`
 * when the config names none this can read. */
function webProxyTarget(config: Record<string, unknown>, port: number): string {
  const web = record(config['Web']);
  if (!web) return '';
  for (const [hostPort, entry] of Object.entries(web)) {
    if (!hostPort.endsWith(`:${port}`)) continue;
    const handlers = record(record(entry)?.['Handlers']);
    if (!handlers) continue;
    for (const handler of Object.values(handlers)) {
      const proxy = record(handler)?.['Proxy'];
      if (typeof proxy === 'string') return proxy;
    }
  }
  return '';
}

/** The proxy target already configured for `port`, `null` when the port is
 * free. An empty string means "served, but by something whose target this
 * cannot read" — still a conflict, just one it cannot name. */
function existingProxyTarget(config: unknown, port: number): string | null {
  const root = record(config);
  const tcp = root && record(root['TCP']);
  if (!root || !tcp || !(String(port) in tcp)) return null;
  return webProxyTarget(root, port);
}

async function readExistingTarget(
  run: CommandRunner,
  port: number
): Promise<string | null> {
  const outcome = requireTailscaleInstalled(
    await run(['tailscale', 'serve', 'status', '--json'], STATUS_TIMEOUT_MS)
  );
  if (outcome.timedOut || outcome.code !== 0) {
    throw new RuntimeError(
      `--tailscale-serve: "tailscale serve status --json" failed (exit ${outcome.code}): ` +
        `${
          firstLine(outcome.stderr) || firstLine(outcome.stdout) || 'no output'
        }`
    );
  }
  return existingProxyTarget(
    parseJson(outcome.stdout, 'serve status --json'),
    port
  );
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? '';
}

function offArgv(port: number): string[] {
  return ['tailscale', 'serve', `--https=${port}`, 'off'];
}

function makeStop(
  run: CommandRunner,
  port: number
): TailscaleServeHandle['stop'] {
  let stopped = false;
  return async (log) => {
    if (stopped) return;
    stopped = true;
    const outcome = await run(offArgv(port), SERVE_TIMEOUT_MS).catch(
      (error: Error): CommandOutcome => ({
        code: null,
        stdout: '',
        stderr: error.message,
        timedOut: false,
      })
    );
    if (outcome.timedOut || outcome.code !== 0) {
      log(
        `could not remove the tailscale serve mapping on port ${port} — ` +
          `run "${offArgv(port).join(' ')}" by hand: ` +
          `${
            firstLine(outcome.stderr) ||
            firstLine(outcome.stdout) ||
            'no output'
          }`
      );
    }
  };
}

export interface StartTailscaleServeOptions {
  run: CommandRunner;
  /** The loopback port the beam node bound. */
  localPort: number;
  port?: number;
}

/**
 * Brings the mapping up and hands back the tailnet origin to advertise.
 *
 * `--bg` is what makes this a one-shot call rather than a child process
 * beam has to supervise for its whole life: the mapping lives in tailscaled
 * and outlives the command that set it. Its cost is that the mapping also
 * outlives a beam that crashes, which is why an already-served port is a
 * checked, named condition rather than something to overwrite.
 */
export async function startTailscaleServe(
  options: StartTailscaleServeOptions
): Promise<TailscaleServeHandle> {
  const { run, localPort } = options;
  const port = options.port ?? TAILSCALE_HTTPS_PORT;
  const { dnsName } = await fetchTailnetIdentity(run);
  const target = `http://127.0.0.1:${localPort}`;

  const existing = await readExistingTarget(run, port);
  if (existing !== null && existing !== target) {
    throw new RuntimeError(
      `--tailscale-serve: tailscale already serves port ${port}` +
        (existing === '' ? '' : ` (-> ${existing})`) +
        ' — beam will not take over a mapping it did not create. Remove it with ' +
        `"${offArgv(port).join(
          ' '
        )}", or let the process that owns it exit first.`
    );
  }

  const handle: TailscaleServeHandle = {
    dnsName,
    origin: `https://${dnsName}`,
    stop: makeStop(run, port),
  };

  // Adopting an identical mapping (a re-run after a crash, same --port)
  // needs no call: the mapping already says exactly what this one would.
  if (existing === target) return handle;

  const argv = ['tailscale', 'serve', '--bg', `--https=${port}`, target];
  const outcome = requireTailscaleInstalled(await run(argv, SERVE_TIMEOUT_MS));
  if (outcome.timedOut) {
    throw new RuntimeError(
      `--tailscale-serve: "${argv.join(' ')}" did not finish within ` +
        `${
          SERVE_TIMEOUT_MS / 1000
        }s. tailscale serve blocks rather than failing when ` +
        `serve is not enabled for the tailnet — enable it at ${ADMIN_DNS_URL}.`
    );
  }
  if (outcome.code !== 0) {
    throw new RuntimeError(
      `--tailscale-serve: "${argv.join(' ')}" failed (exit ${outcome.code}): ` +
        `${
          firstLine(outcome.stderr) || firstLine(outcome.stdout) || 'no output'
        }`
    );
  }
  return handle;
}
