import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { BeamNodeCtor } = vi.hoisted(() => ({ BeamNodeCtor: vi.fn() }));
vi.mock('./beam-node.js', () => ({ BeamNode: BeamNodeCtor }));

type FakeParentPort = EventEmitter & {
  postMessage: ReturnType<typeof vi.fn>;
};

function fakeParentPort(): FakeParentPort {
  return Object.assign(new EventEmitter(), { postMessage: vi.fn() });
}

let parentPort: FakeParentPort;

beforeEach(() => {
  vi.resetModules();
  BeamNodeCtor.mockReset();
  parentPort = fakeParentPort();
  Object.defineProperty(process, 'parentPort', {
    value: parentPort,
    configurable: true,
  });
});

afterEach(() => {
  delete (process as { parentPort?: unknown }).parentPort;
});

/** A constructor throw mirrors `BeamNode`'s synchronous disk I/O
 *  (`loadOrCreateIdentity` etc.) failing on a corrupt or unreadable
 *  `$BEAM_DIR` — the case finding 2 is about. */
function makeConstructionThrow(message: string): void {
  BeamNodeCtor.mockImplementation(function throwing() {
    throw new Error(message);
  });
}

describe('beam-node-worker: a startup failure is reported, not a silent crash (finding 2)', () => {
  it('posts a startup-failed event once so the bridge learns the reason, not just a bare exit', async () => {
    makeConstructionThrow('EACCES: permission denied, open "identity.json"');
    await import('./beam-node-worker.js');
    expect(parentPort.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'startup-failed',
      payload: {
        message: 'EACCES: permission denied, open "identity.json"',
      },
    });
  });

  it('answers a request with the specific startup failure instead of throwing', async () => {
    makeConstructionThrow('bad $BEAM_DIR');
    await import('./beam-node-worker.js');
    parentPort.emit('message', { data: { id: 1, op: 'listMachines' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(parentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'response',
        id: 1,
        ok: false,
        error: expect.stringContaining('bad $BEAM_DIR'),
      })
    );
  });

  it('never exits the process over a startup failure — nothing for the bridge to restart', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    makeConstructionThrow('boom');
    await import('./beam-node-worker.js');
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('beam-node-worker: the happy path is unchanged', () => {
  it('still round-trips an op through the constructed node', async () => {
    const listMachines = vi.fn().mockReturnValue(['fake-machine']);
    BeamNodeCtor.mockImplementation(function fakeBeamNode(
      this: Record<string, unknown>
    ) {
      this.listMachines = listMachines;
      this.onChange = () => undefined;
      this.remote = { onStreamEvent: () => undefined };
      this.mail = { onMail: () => undefined, ack: () => false };
    });
    await import('./beam-node-worker.js');
    parentPort.emit('message', { data: { id: 7, op: 'listMachines' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(listMachines).toHaveBeenCalled();
    expect(parentPort.postMessage).toHaveBeenCalledWith({
      kind: 'response',
      id: 7,
      ok: true,
      result: ['fake-machine'],
    });
  });

  it('forwards a mail-inbound event pushed by the node', async () => {
    let push: ((event: unknown) => void) | undefined;
    BeamNodeCtor.mockImplementation(function fakeBeamNode(
      this: Record<string, unknown>
    ) {
      this.onChange = () => undefined;
      this.remote = { onStreamEvent: () => undefined };
      this.mail = {
        onMail: (cb: (event: unknown) => void) => {
          push = cb;
        },
        ack: () => false,
      };
    });
    await import('./beam-node-worker.js');
    push?.({ id: 'env-1', from: 'bbbbbbbbbbbbbbbb' });
    expect(parentPort.postMessage).toHaveBeenCalledWith({
      kind: 'event',
      name: 'mail-inbound',
      payload: { id: 'env-1', from: 'bbbbbbbbbbbbbbbb' },
    });
  });

  it("routes the ackMail op to the node's mail subscriber", async () => {
    const ack = vi.fn().mockReturnValue(true);
    BeamNodeCtor.mockImplementation(function fakeBeamNode(
      this: Record<string, unknown>
    ) {
      this.onChange = () => undefined;
      this.remote = { onStreamEvent: () => undefined };
      this.mail = { onMail: () => undefined, ack };
    });
    await import('./beam-node-worker.js');
    parentPort.emit('message', {
      data: { id: 9, op: 'ackMail', payload: { id: 'env-1' } },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ack).toHaveBeenCalledWith('env-1');
    expect(parentPort.postMessage).toHaveBeenCalledWith({
      kind: 'response',
      id: 9,
      ok: true,
      result: true,
    });
  });
});
