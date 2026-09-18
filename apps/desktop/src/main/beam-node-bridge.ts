import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import type {
  AcceptingStatus,
  MachineView,
  PairConfirmResult,
  PairPreviewResult,
} from '../host/contract-machines.js';
import {
  getLastKnownMachines,
  receiveMachinesUpdate,
  setMachinesPort,
  type MachinesPort,
} from '../host/services/machines.js';
import type {
  BeamNodeRequest,
  BeamWorkerMessage,
} from './beam-node-protocol.js';
import type {
  RemoteMachinePort,
  StreamEventPayload,
} from '../host/services/remote-machines.js';
import { setRemoteMachinePort } from '../host/services/remote-machines.js';
import { parseStreamId, wrapStreamId } from './beam-stream-id.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Bounded restart policy for a worker that keeps exiting after it
 *  successfully started (finding 2) — a startup failure never reaches
 *  this path at all, since `beam-node-worker.ts` now catches its own
 *  construction throw and stays up to report it. Exponential, capped,
 *  and finite: an unbounded fork loop is worse than giving up and
 *  leaving the last synthetic "unreachable" push on screen. */
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const MAX_RESTART_ATTEMPTS = 5;

function restartDelayFor(attempt: number): number {
  return Math.min(RESTART_BASE_DELAY_MS * 2 ** attempt, RESTART_MAX_DELAY_MS);
}

/**
 * Forks the beam node's utility process on first use (lazily — the app
 * must not start a node just because it launched, decisions.md D10) and
 * keeps it running for the app's life, restarting it if it exits
 * unexpectedly. This is the entire main-process footprint of beam: the
 * main process owns this request/response call, the event forwarding,
 * and the restart policy — nothing about identity, peers, accepting or
 * streams, which all live in `beam-node.ts`, run inside the worker.
 */
export class BeamNodeBridge implements MachinesPort, RemoteMachinePort {
  private child: UtilityProcess | null = null;
  private starting: Promise<UtilityProcess> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly ptyEventListeners = new Set<
    (event: StreamEventPayload) => void
  >();
  private shuttingDown = false;
  /** Bumped once per forked worker. Every pty stream id handed to a
   *  caller is wrapped with the generation that opened it
   *  (`beam-stream-id.ts`), so a handle from a worker that has since
   *  died can never be mistaken for a same-numbered stream on its
   *  replacement (finding 1) — `RemoteOps.nextStreamId` restarts at 1
   *  in every fresh worker process. */
  private generation = 0;
  /** Wrapped ids for streams the current worker has open. Walked on
   *  exit to synthesize the closes that worker will never send. */
  private readonly openStreams = new Set<string>();
  private restartAttempts = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;

  private ensureChild(): Promise<UtilityProcess> {
    if (this.child) return Promise.resolve(this.child);
    if (this.starting) return this.starting;
    // Finding 8: without this, a call that lands after `shutdown()`
    // has already killed the child — `dispose()` → `ptyClose` →
    // `request()` is the brief's example — re-forks a fresh worker
    // instead of failing, undoing the very shutdown in progress.
    if (this.shuttingDown)
      return Promise.reject(new Error('beam node is shutting down'));
    this.generation += 1;
    this.starting = new Promise((resolve) => {
      const child = utilityProcess.fork(
        join(import.meta.dirname, 'beam-node-worker.js'),
        [],
        { stdio: 'ignore', serviceName: 'n10 beam node' }
      );
      child.on('message', (message: BeamWorkerMessage) =>
        this.onMessage(message)
      );
      child.once('exit', (code) => this.onExit(code));
      this.child = child;
      resolve(child);
    });
    return this.starting.finally(() => {
      this.starting = null;
    });
  }

  private onMessage(message: BeamWorkerMessage): void {
    // Any message at all is proof the worker started successfully —
    // reset the backoff counter so a later, unrelated crash gets the
    // same bounded retries a fresh install would.
    this.restartAttempts = 0;
    if (message.kind === 'event') {
      if (message.name === 'changed') {
        receiveMachinesUpdate(message.payload as MachineView[]);
      } else if (message.name === 'pty-data') {
        const { streamId, data } = message.payload;
        const wrapped = wrapStreamId(this.generation, streamId);
        for (const cb of this.ptyEventListeners)
          cb({ kind: 'data', streamId: wrapped, data });
      } else if (message.name === 'pty-closed') {
        const wrapped = wrapStreamId(this.generation, message.payload.streamId);
        this.openStreams.delete(wrapped);
        for (const cb of this.ptyEventListeners)
          cb({ kind: 'closed', streamId: wrapped });
      }
      // 'startup-failed' needs no bridge-side reaction beyond the
      // failure message every pending call already gets: the worker
      // that posted it stays alive and answers every op with that
      // same reason (beam-node-worker.ts), so there is nothing here
      // to restart or synthesize.
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  /** Emits the `pty-closed` a dead worker will never send, for every
   *  stream that was open on it — without this, `RemoteTmuxBackend`
   *  (via `remote-machines.ts`'s `openPty`) never learns its transport
   *  died and keeps reporting `connectionState: 'connected'` over a
   *  worker that no longer exists (finding 1). */
  private closeOpenStreams(): void {
    for (const streamId of this.openStreams) {
      for (const cb of this.ptyEventListeners) cb({ kind: 'closed', streamId });
    }
    this.openStreams.clear();
  }

  /** `streamId` belongs to the worker generation running right now —
   *  `false` for a handle whose worker has since exited. A stale
   *  handle must fail (or, for the fire-and-forget pty ops, silently
   *  no-op) rather than land on whatever the new worker happens to
   *  call the same raw id (finding 1). */
  private currentGenerationRawId(streamId: string): string | null {
    const parsed = parseStreamId(streamId);
    return parsed && parsed.generation === this.generation
      ? parsed.rawId
      : null;
  }

  /**
   * An unexpected exit must read as every machine going away, never as
   * "no machines" — the two look identical in an empty list, but they
   * are not the same fact, and a user with a healthy paired machine
   * must see a fault, not have it quietly disappear (the brief's own
   * regression to guard against). Local stays as it was — it is still
   * this process, whatever the node is doing — and a revoked peer stays
   * revoked, since that state does not depend on the node being alive.
   */
  private onExit(code: number | null): void {
    this.child = null;
    this.closeOpenStreams();
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`beam node exited unexpectedly (${code})`));
    }
    this.pending.clear();
    if (this.shuttingDown) return;
    const synthetic = getLastKnownMachines().map(
      (m): MachineView =>
        m.isLocal || m.state === 'revoked'
          ? m
          : { ...m, state: 'unreachable', transport: null }
    );
    if (synthetic.length > 0) receiveMachinesUpdate(synthetic);
    this.scheduleRestart();
  }

  /** Bounded, backed-off retry (finding 2): a worker that keeps dying
   *  after it started (not a caught startup failure — that one never
   *  exits at all) gets a handful of increasingly spaced-out chances
   *  before this gives up. Giving up leaves the last synthetic
   *  "unreachable" push from `onExit` on screen rather than looping
   *  forever with nothing to show for it. */
  private scheduleRestart(): void {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) return;
    const delay = restartDelayFor(this.restartAttempts);
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => void this.ensureChild(), delay);
    this.restartTimer.unref?.();
  }

  private request<T>(op: string, payload?: unknown): Promise<T> {
    return this.ensureChild().then(
      (child) =>
        new Promise<T>((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
          });
          const request: BeamNodeRequest = { id, op, payload };
          child.postMessage(request);
        })
    );
  }

  listMachines(): Promise<MachineView[]> {
    return this.request('listMachines');
  }

  getAcceptingStatus(): Promise<AcceptingStatus> {
    return this.request('getAcceptingStatus');
  }

  setAccepting(enabled: boolean): Promise<AcceptingStatus> {
    return this.request('setAccepting', { enabled });
  }

  regeneratePairingUrl(): Promise<AcceptingStatus> {
    return this.request('regeneratePairingUrl');
  }

  previewPairing(url: string): Promise<PairPreviewResult> {
    return this.request('previewPairing', { url });
  }

  confirmPairing(url: string, force: boolean): Promise<PairConfirmResult> {
    return this.request('confirmPairing', { url, force });
  }

  renameMachine(peerId: string, label: string): Promise<MachineView> {
    return this.request('renameMachine', { peerId, label });
  }

  revokeMachine(peerId: string): Promise<MachineView> {
    return this.request('revokeMachine', { peerId });
  }

  forgetMachine(peerId: string): Promise<void> {
    return this.request('forgetMachine', { peerId });
  }

  execOn(
    peerId: string,
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return this.request('execOn', { peerId, argv, ...opts });
  }

  async ptyOpen(
    peerId: string,
    params: {
      argv?: string[];
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    }
  ): Promise<{ streamId: string }> {
    const { streamId } = await this.request<{ streamId: string }>('ptyOpen', {
      peerId,
      ...params,
    });
    const wrapped = wrapStreamId(this.generation, streamId);
    this.openStreams.add(wrapped);
    return { streamId: wrapped };
  }

  ptyWrite(streamId: string, data: string): void {
    // Fire-and-forget, like the local PtySession.write() this mirrors:
    // a write racing the stream's own close is not an error the caller
    // needs to hear about, only one to not crash on. A stale handle
    // (its worker generation is already gone) is dropped outright
    // rather than sent — forwarding it risks landing on whatever the
    // new worker happens to call the same raw id (finding 1).
    const rawId = this.currentGenerationRawId(streamId);
    if (rawId === null) return;
    this.request('ptyWrite', { streamId: rawId, data }).catch(() => undefined);
  }

  ptyResize(streamId: string, cols: number, rows: number): void {
    const rawId = this.currentGenerationRawId(streamId);
    if (rawId === null) return;
    this.request('ptyResize', { streamId: rawId, cols, rows }).catch(
      () => undefined
    );
  }

  ptyClose(streamId: string): void {
    this.openStreams.delete(streamId);
    const rawId = this.currentGenerationRawId(streamId);
    if (rawId === null) return;
    this.request('ptyClose', { streamId: rawId }).catch(() => undefined);
  }

  onPtyEvent(cb: (event: StreamEventPayload) => void): () => void {
    this.ptyEventListeners.add(cb);
    return () => this.ptyEventListeners.delete(cb);
  }

  /**
   * App quit: ask the node to stop accepting, close connections and let
   * the mailbox flush what it can, then let it exit itself. Bounded —
   * a hung worker must not block the app from quitting.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearTimeout(this.restartTimer);
    if (!this.child) return;
    try {
      await Promise.race([
        this.request('shutdown'),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // The worker may have exited before answering — fine, we are
      // shutting down either way.
    }
    this.child?.kill();
    this.child = null;
  }
}

/** Installs the bridge as both the machines service's port and the
 *  remote-machine (executor + pty) port. Call once at startup, before
 *  the first machines API call. */
export function installBeamNodeBridge(): BeamNodeBridge {
  const bridge = new BeamNodeBridge();
  setMachinesPort(bridge);
  setRemoteMachinePort(bridge);
  return bridge;
}
