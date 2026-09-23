import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * Real beam processes for the `@beam` tests (docs/testing.md). The
 * testkit and each daemon run with `--exit-with-parent`, holding a stdin
 * pipe this worker never writes, so a worker that dies takes them with it.
 */

export const BEAM_TEST_BINARY = process.env.BEAM_TEST_BINARY;

/** beam's own grace for a daemon that was asked to stop. */
const STOP_GRACE_MS = 12_000;
const START_TIMEOUT_MS = 20_000;

/** A child started with `--exit-with-parent`, and its stderr tail for a
 *  failure message. `stop` closes its stdin and sends SIGTERM, either of
 *  which stops it, then kills it after beam's grace. */
class Held {
  private tail: string[] = [];
  private readonly ended: Promise<void>;

  constructor(readonly child: ChildProcess, readonly name: string) {
    this.ended = new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', (err) => {
        this.tail.push(String(err));
        resolve();
      });
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.tail = [...this.tail, ...chunk.split('\n')].slice(-20);
    });
  }

  get exited(): boolean {
    return (
      this.child.pid === undefined ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    );
  }

  /** Resolves once it has exited, or never started. */
  get done(): Promise<void> {
    return this.ended;
  }

  describe(): string {
    return `${this.name} exited (${
      this.child.exitCode ?? this.child.signalCode
    }): ${this.tail.join('\n')}`;
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    this.child.stdin?.end();
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), STOP_GRACE_MS);
    await this.ended;
    clearTimeout(timer);
  }
}

const SCRUBBED = new Set([
  'TMUX',
  'TMUX_PANE',
  'BEAM_CONFIG_DIR',
  'BEAM_SOCKET',
]);

/** The environment a beam process runs with: the fixture's HOME and
 *  tmux socket directory, no developer beam or tmux, and peers that talk
 *  only through the testkit's relay. */
function beamEnv(
  home: string,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SCRUBBED.has(name))
  );
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    TS_DEBUG_ALWAYS_USE_DERP: 'true',
    ...extra,
    TMUX_TMPDIR: home,
  };
}

export interface Testkit {
  derpMap: string;
  directory: string;
  /** The fleet owner's passkey (`BEAM_TEST_AUTHENTICATOR`), which every
   *  daemon's ceremonies answer with. A CLI given it opens no browser. */
  authenticator: string;
  stop(): Promise<void>;
}

/** Starts `beam testkit` and reads the one JSON line naming its DERP
 *  map and directory. */
export async function startTestkit(home: string): Promise<Testkit> {
  const held = new Held(
    spawn(BEAM_TEST_BINARY!, ['testkit', '--exit-with-parent'], {
      env: beamEnv(home),
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
    'beam testkit'
  );
  const { derpMap, directory } = await new Promise<string>(
    (resolve, reject) => {
      const lines = createInterface({ input: held.child.stdout! });
      const timer = setTimeout(
        () => reject(new Error('beam testkit printed nothing')),
        START_TIMEOUT_MS
      );
      lines.once('line', (l) => (clearTimeout(timer), resolve(l)));
      void held.done.then(() => reject(new Error(held.describe())));
    }
  )
    .then((line) => JSON.parse(line) as { derpMap: string; directory: string })
    .catch(async (err: unknown) => {
      await held.stop();
      throw err;
    });
  return {
    derpMap,
    directory,
    authenticator: testAuthenticator(),
    stop: () => held.stop(),
  };
}

/**
 * A software passkey as `BEAM_TEST_AUTHENTICATOR` takes it (beam
 * docs/10): a base64url credential id, an ES256 key in PKCS #8 and a PRF
 * secret, the byte fields standard base64 as Go encodes them.
 */
function testAuthenticator(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return JSON.stringify({
    credentialId: randomBytes(16).toString('base64url'),
    privateKey: privateKey
      .export({ type: 'pkcs8', format: 'der' })
      .toString('base64'),
    prfSecret: randomBytes(32).toString('base64'),
  });
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** One machine: a `beam daemon` over its own directory, and the CLI
 *  pointed at it. */
export interface BeamMachine {
  cli(args: string[]): Promise<CliResult>;
  /** This machine's peerId, from `beam status --json`. */
  peerId(): Promise<string>;
  stop(): Promise<void>;
}

function canConnect(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = connect(socket);
    conn.once('connect', () => (conn.destroy(), resolve(true)));
    conn.once('error', () => resolve(false));
  });
}

/** Starts `beam daemon` on the kit with `home` as its HOME, beam's
 *  directory at `$HOME/.config/beam`, and waits for its control socket
 *  to answer. */
export async function startMachine(
  home: string,
  kit: Testkit
): Promise<BeamMachine> {
  const configDir = join(home, '.config', 'beam');
  const env = beamEnv(home, {
    BEAM_CONFIG_DIR: configDir,
    BEAM_TEST_AUTHENTICATOR: kit.authenticator,
  });
  const held = new Held(
    spawn(
      BEAM_TEST_BINARY!,
      [
        'daemon',
        '--derp-map',
        kit.derpMap,
        '--directory',
        kit.directory,
        '--exit-with-parent',
      ],
      { env, stdio: ['pipe', 'ignore', 'pipe'] }
    ),
    `beam daemon (${configDir})`
  );
  const socket = join(configDir, 'run', 'beam.sock');
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!(await canConnect(socket))) {
    if (held.exited) throw new Error(held.describe());
    if (Date.now() > deadline) {
      await held.stop();
      throw new Error(`${held.name} did not answer on ${socket}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // A CLI call with no daemon answering starts one, on beam's real DERP
  // and directory: never make one after this daemon has gone.
  const cli = (args: string[]): Promise<CliResult> =>
    new Promise((resolve, reject) => {
      if (held.exited) return reject(new Error(held.describe()));
      const child = spawn(BEAM_TEST_BINARY!, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
  return {
    cli,
    async peerId() {
      const { code, stdout, stderr } = await cli(['status', '--json']);
      if (code !== 0) throw new Error(`beam status: ${stderr}`);
      return (JSON.parse(stdout) as { peerId: string }).peerId;
    },
    stop: () => held.stop(),
  };
}
