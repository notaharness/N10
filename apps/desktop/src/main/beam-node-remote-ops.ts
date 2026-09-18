/**
 * The data- and control-plane half of the desktop's beam node: running
 * a command on another machine (`execOn`, the `MachineExecutor` D5
 * needs) and attaching an interactive `pty` stream to it (`ptyOpen` +
 * `ptyWrite`/`ptyResize`/`ptyClose`, the D4 remote backend's transport).
 * Split out of `beam-node.ts` to keep that file under the line budget;
 * `BeamNode` composes one of these and delegates.
 */
import {
  decodeExecExit,
  demuxExecData,
  dial as beamDial,
  EXEC_CHANNEL_STDERR,
  EXEC_CHANNEL_STDIN,
  EXEC_CHANNEL_STDOUT,
  prefixChannel,
  type BeamStream,
  type ConnectionRegistry,
  type Identity,
  type PeerConnection,
  type PeerTable,
  type StreamRegistry,
} from '@n10/beam';

/** A remote pty stream's data or close, pushed to whoever installed
 *  `onStreamEvent` (the bridge, which re-emits it as a worker event). */
export type StreamEvent =
  | { kind: 'data'; streamId: string; data: string }
  | { kind: 'closed'; streamId: string };

export interface RemoteOpsDeps {
  /** A getter, not a snapshot: `renameMachine` reassigns the node's
   *  identity object, and a dial started after that must sign with the
   *  current one. */
  getIdentity: () => Identity;
  peers: PeerTable;
  connections: ConnectionRegistry;
  registry: StreamRegistry;
}

export class RemoteOps {
  private readonly ptyStreams = new Map<string, BeamStream>();
  private readonly streamListeners = new Set<(event: StreamEvent) => void>();
  private nextStreamId = 1;

  constructor(private readonly deps: RemoteOpsDeps) {}

  /** Reuses a live connection when one is open; otherwise dials the
   *  peer's first known endpoint. Every remote-machine op goes through
   *  this, never assuming a connection is already there. */
  private async connectionFor(peerId: string): Promise<PeerConnection> {
    const existing = this.deps.connections.get(peerId);
    if (existing) return existing;
    const record = this.deps.peers.list().find((p) => p.peerId === peerId);
    const endpoint = record?.endpoints[0];
    if (!record || !endpoint)
      throw new Error(`no endpoint to dial for machine ${peerId}`);
    await beamDial(endpoint, peerId, {
      identity: this.deps.getIdentity(),
      peers: this.deps.peers,
      registry: this.deps.registry,
      connections: this.deps.connections,
    });
    const connected = this.deps.connections.get(peerId);
    if (!connected) throw new Error(`failed to connect to machine ${peerId}`);
    return connected;
  }

  /** The MachineExecutor half of decisions.md D5: runs `argv` on
   *  `peerId` through an `exec` stream, forwards `opts.stdin` (if
   *  any), and resolves with the remote exit code — the shape
   *  `@n10/terminal-tmux`'s, `@n10/worktree-manager`'s and
   *  `@n10/core`'s `MachineExecutor` interfaces all expect. */
  async execOn(
    peerId: string,
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const connection = await this.connectionFor(peerId);
    const stream = await connection.openStream('exec', {
      argv,
      cwd: opts?.cwd,
      env: opts?.env,
    });
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      stream.onData((data) => {
        const { channel, payload } = demuxExecData(data);
        const text = Buffer.from(payload).toString('utf8');
        if (channel === EXEC_CHANNEL_STDOUT) stdout += text;
        else if (channel === EXEC_CHANNEL_STDERR) stderr += text;
      });
      stream.onClose((reason) => {
        const exit = decodeExecExit(reason);
        if (!exit) {
          reject(
            new Error(
              `exec ended without an exit code: ${reason ?? 'stream closed'}`
            )
          );
          return;
        }
        resolve({ stdout, stderr, code: exit.signal ? 1 : exit.exitCode ?? 1 });
      });
      if (opts?.stdin)
        stream.write(
          prefixChannel(EXEC_CHANNEL_STDIN, Buffer.from(opts.stdin, 'utf8'))
        );
      stream.control({ kind: 'stdin-eof' });
    });
  }

  /** The data-plane half of D4/D5: opens a `pty` stream on `peerId`
   *  and returns an id a caller drives with
   *  `ptyWrite`/`ptyResize`/`ptyClose`. Data and close events are
   *  pushed through `onStreamEvent` rather than returned here, because
   *  they cross the utility-process boundary as `{kind:'event', ...}`
   *  messages (`beam-node-bridge.ts`). */
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
    const connection = await this.connectionFor(peerId);
    const stream = await connection.openStream('pty', params);
    const streamId = `pty-${this.nextStreamId++}`;
    this.ptyStreams.set(streamId, stream);
    stream.onData((data) =>
      this.emitStreamEvent({
        kind: 'data',
        streamId,
        data: Buffer.from(data).toString('utf8'),
      })
    );
    stream.onClose(() => {
      this.ptyStreams.delete(streamId);
      this.emitStreamEvent({ kind: 'closed', streamId });
    });
    return { streamId };
  }

  ptyWrite(streamId: string, data: string): void {
    this.ptyStreams.get(streamId)?.write(Buffer.from(data, 'utf8'));
  }

  ptyResize(streamId: string, cols: number, rows: number): void {
    this.ptyStreams.get(streamId)?.control({ kind: 'resize', cols, rows });
  }

  /** Closes the client's side of the stream only. The pty handler on
   *  the far end kills exactly the process this stream's Open spawned
   *  (`pty-handler.ts`) — for a remote session that process is the
   *  `tmux attach-session` client, not the tmux session itself, so
   *  this is a detach, never a kill. */
  ptyClose(streamId: string): void {
    const stream = this.ptyStreams.get(streamId);
    if (!stream) return;
    this.ptyStreams.delete(streamId);
    stream.close();
  }

  onStreamEvent(cb: (event: StreamEvent) => void): () => void {
    this.streamListeners.add(cb);
    return () => this.streamListeners.delete(cb);
  }

  private emitStreamEvent(event: StreamEvent): void {
    for (const cb of this.streamListeners) cb(event);
  }

  dispose(): void {
    for (const stream of this.ptyStreams.values()) stream.close();
    this.ptyStreams.clear();
    this.streamListeners.clear();
  }
}
