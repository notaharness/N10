import { setTimeout as delay } from 'node:timers/promises';
import { ControlConnection } from './control.js';
import type { DaemonExit, OwnedDaemon } from './owned-daemon.js';

/** beam docs/06: a spawned daemon's socket appears within 5 s. */
const SOCKET_WAIT_MS = 5_000;
const SOCKET_POLL_MS = 100;
/** How long a daemon asked to stop gets before it is killed: beam gives
 *  its streams up to 10 s to end first. */
const STOP_GRACE_MS = 12_000;
/** beam docs/06: a daemon that finds another holding the directory or
 *  its socket exits 1 saying so — it lost the start race, and the
 *  winner serves. Every other error is exit 1 as well. */
const LOST_START_RACE = /another daemon (holds|is listening)/;

function describeExit(exit: DaemonExit): string {
  if (exit.error) return `the daemon could not run: ${exit.error}`;
  if (exit.lastLine) return exit.lastLine;
  return `the daemon exited (${exit.signal ?? `code ${exit.code}`})`;
}

/** docs/06: only no socket, or one nobody listens on, means no daemon. */
function noDaemon(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ECONNREFUSED';
}

/**
 * Connect-or-spawn, with the app as the owner (decisions.md D15): a
 * daemon already running is used and left alone; otherwise the app
 * starts one and stops it through the child it holds, never over the
 * socket (whoever answers there may not be it), then kills it once the
 * grace runs out.
 */
export class DaemonLauncher {
  private owned: OwnedDaemon | null = null;
  private stopping = false;

  constructor(
    private readonly socketPath: string,
    private readonly spawnDaemon?: () => OwnedDaemon,
    private readonly graceMs = STOP_GRACE_MS
  ) {}

  async connect(): Promise<ControlConnection> {
    try {
      return await ControlConnection.connect(this.socketPath);
    } catch (err) {
      if (!noDaemon(err)) {
        throw new Error(`beam could not be reached: ${String(err)}`, {
          cause: err,
        });
      }
      if (!this.spawnDaemon || this.stopping) {
        throw new Error('beam is not running on this machine.', { cause: err });
      }
    }
    let owned = this.owned;
    if (!owned) {
      const spawned = this.spawnDaemon();
      this.owned = owned = spawned;
      // `exited` never rejects.
      void spawned.exited.then(() => {
        if (this.owned === spawned) this.owned = null;
      });
    }
    return this.waitForSocket(owned);
  }

  /** Stops the daemon this app started, if it did, and starts no other
   *  after. A daemon it found running is left alone. */
  async stop(): Promise<void> {
    this.stopping = true;
    const owned = this.owned;
    if (!owned) return;
    owned.stop();
    const exited = await Promise.race([
      owned.exited.then(() => true),
      delay(this.graceMs).then(() => false),
    ]);
    if (!exited) owned.kill();
  }

  /** Waits for any daemon to answer, not only `owned`: one that lost
   *  the start race exits and the winner answers, and is not this app's
   *  to stop. Any other exit before an answer is a failure to start. */
  private async waitForSocket(owned: OwnedDaemon): Promise<ControlConnection> {
    const deadline = Date.now() + SOCKET_WAIT_MS;
    const ended: { exit: DaemonExit | null } = { exit: null };
    // `exited` never rejects.
    void owned.exited.then((exit) => (ended.exit = exit));
    for (;;) {
      try {
        return await ControlConnection.connect(this.socketPath);
      } catch (err) {
        const exit = ended.exit;
        if (exit && !LOST_START_RACE.test(exit.lastLine ?? '')) {
          throw new Error(`beam could not start: ${describeExit(exit)}`);
        }
        if (Date.now() >= deadline) {
          throw new Error(`beam could not start: ${String(err)}`, {
            cause: err,
          });
        }
        await delay(SOCKET_POLL_MS);
      }
    }
  }
}
