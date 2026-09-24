import { StringDecoder } from 'node:string_decoder';
import type {
  RemoteMachinePort,
  StreamEventPayload,
} from '../../host/services/remote-machines.js';
import { AttachStream, type StreamEnd } from './attach.js';

/** What the remote port needs from the client: a request on the shared
 *  control connection, and the socket path attaches dial. */
export interface BeamLink {
  request<T>(op: string, fields: Record<string, unknown>): Promise<T>;
  socketPath: string;
}

/** Input frames are chunked well under beam's 1 MiB payload cap. */
const INPUT_CHUNK = 256 * 1024;
/** beam docs/04: exec data payloads lead with a channel byte. */
const CHANNEL = { stdin: 0, stdout: 1, stderr: 2 } as const;
/** beam docs/04: a resize is 2–500 in each dimension. */
const clampGrid = (n: number) => Math.min(500, Math.max(2, Math.round(n)));

function chunks(bytes: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += INPUT_CHUNK) {
    out.push(bytes.subarray(i, i + INPUT_CHUNK));
  }
  return out;
}

function describeEnd(peerId: string, end: StreamEnd): string {
  const why = end.detail ? `${end.reason} (${end.detail})` : end.reason;
  return `beam: the stream to ${peerId} ended: ${why}`;
}

async function execOn(
  link: BeamLink,
  peerId: string,
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { streamId } = await link.request<{ streamId: string }>('exec.open', {
    peer: peerId,
    argv,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  });
  const stream = await AttachStream.open(link.socketPath, streamId);
  const out: Record<1 | 2, Buffer[]> = { 1: [], 2: [] };
  stream.onData((payload) => {
    const channel = payload[0];
    if (channel === CHANNEL.stdout || channel === CHANNEL.stderr) {
      out[channel].push(payload.subarray(1));
    }
  });
  const ended = new Promise<StreamEnd>((resolve) => stream.onEnd(resolve));
  for (const chunk of chunks(Buffer.from(opts.stdin ?? '', 'utf8'))) {
    stream.sendData(Buffer.concat([Buffer.from([CHANNEL.stdin]), chunk]));
  }
  stream.sendControl({ kind: 'stdin-eof' });
  const end = await ended;
  if (end.reason !== 'exit' || end.exitCode === undefined) {
    throw new Error(describeEnd(peerId, end));
  }
  return {
    stdout: Buffer.concat(out[CHANNEL.stdout]).toString('utf8'),
    stderr: Buffer.concat(out[CHANNEL.stderr]).toString('utf8'),
    code: end.exitCode,
  };
}

/**
 * `RemoteMachinePort` over beam's control socket (beam docs/06): a
 * command is `exec.open` plus an attach, a terminal `pty.open` plus an
 * attach. The daemon dials the peer on attach, so nothing here pools or
 * checks connections, and `reconnect` needs no handling.
 */
export function createRemoteMachinePort(link: BeamLink): RemoteMachinePort {
  const streams = new Map<string, AttachStream>();
  const listeners = new Set<(event: StreamEventPayload) => void>();
  const emit = (event: StreamEventPayload) => {
    for (const listener of listeners) listener(event);
  };

  return {
    execOn: (peerId, argv, opts) => execOn(link, peerId, argv, opts),

    async ptyOpen(peerId, params) {
      const { streamId } = await link.request<{ streamId: string }>(
        'pty.open',
        {
          peer: peerId,
          ...(params.argv?.length ? { argv: params.argv } : {}),
          ...(params.cwd ? { cwd: params.cwd } : {}),
          ...(params.env ? { env: params.env } : {}),
          cols: clampGrid(params.cols ?? 80),
          rows: clampGrid(params.rows ?? 24),
        }
      );
      const stream = await AttachStream.open(link.socketPath, streamId);
      const text = new StringDecoder('utf8');
      streams.set(streamId, stream);
      stream.onData((payload) => {
        const data = text.write(payload);
        if (data) emit({ kind: 'data', streamId, data });
      });
      stream.onEnd(() => {
        streams.delete(streamId);
        emit({ kind: 'closed', streamId });
      });
      return { streamId };
    },

    ptyWrite(streamId, data) {
      const stream = streams.get(streamId);
      for (const chunk of chunks(Buffer.from(data, 'utf8'))) {
        stream?.sendData(chunk);
      }
    },

    ptyResize(streamId, cols, rows) {
      streams.get(streamId)?.sendControl({
        kind: 'resize',
        cols: clampGrid(cols),
        rows: clampGrid(rows),
      });
    },

    ptyClose(streamId) {
      streams.get(streamId)?.close();
    },

    onPtyEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
