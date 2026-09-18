import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installMachineResolver,
  machineFor,
  setRemoteMachinePort,
  type RemoteMachinePort,
  type StreamEventPayload,
} from './remote-machines.js';

const state = vi.hoisted(() => ({
  resolver: null as ((id: string) => unknown) | null,
}));
vi.mock('@n10/core', () => ({
  setMachineResolver: (fn: (id: string) => unknown) => {
    state.resolver = fn;
  },
}));

function fakePort(): RemoteMachinePort & {
  emit: (event: StreamEventPayload) => void;
} {
  const listeners = new Set<(event: StreamEventPayload) => void>();
  return {
    execOn: vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 })),
    ptyOpen: vi.fn(async () => ({ streamId: 's1' })),
    ptyWrite: vi.fn(),
    ptyResize: vi.fn(),
    ptyClose: vi.fn(),
    onPtyEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit: (event) => listeners.forEach((cb) => cb(event)),
  };
}

beforeEach(() => {
  setRemoteMachinePort(null);
  state.resolver = null;
});

describe("remote-machines (the main-process face of the beam node's execOn/pty capability)", () => {
  it('machineFor throws when no port is installed, rather than returning a machine that silently fails', () => {
    expect(() => machineFor('peer-abc')).toThrow(/not available/);
  });

  it('the executor runs argv through the port for that specific peerId', async () => {
    const port = fakePort();
    setRemoteMachinePort(port);
    const machine = machineFor('peer-abc');
    const result = await machine.executor.run(['echo', 'hi']);
    expect(result).toEqual({ stdout: 'ok', stderr: '', code: 0 });
    expect(port.execOn).toHaveBeenCalledWith(
      'peer-abc',
      ['echo', 'hi'],
      undefined
    );
  });

  it('the pty opener filters events to its own streamId, not another concurrent stream', async () => {
    const port = fakePort();
    setRemoteMachinePort(port);
    const machine = machineFor('peer-abc');
    const handle = await machine.ptyOpener.open({ cols: 80, rows: 24 });
    const chunks: string[] = [];
    handle.onData((d) => chunks.push(d));
    port.emit({ kind: 'data', streamId: 'other-stream', data: 'not mine' });
    port.emit({ kind: 'data', streamId: 's1', data: 'mine' });
    expect(chunks).toEqual(['mine']);

    handle.write('x');
    expect(port.ptyWrite).toHaveBeenCalledWith('s1', 'x');
    handle.resize(100, 40);
    expect(port.ptyResize).toHaveBeenCalledWith('s1', 100, 40);
  });

  it('dispose() calls ptyClose (detach) and unsubscribes from events', async () => {
    const port = fakePort();
    setRemoteMachinePort(port);
    const machine = machineFor('peer-abc');
    const handle = await machine.ptyOpener.open({ cols: 80, rows: 24 });
    handle.dispose();
    expect(port.ptyClose).toHaveBeenCalledWith('s1');
  });

  it('a close event calls onClose handlers and stops delivering further data for that stream', async () => {
    const port = fakePort();
    setRemoteMachinePort(port);
    const machine = machineFor('peer-abc');
    const handle = await machine.ptyOpener.open({ cols: 80, rows: 24 });
    const closed = vi.fn();
    handle.onClose(closed);
    port.emit({ kind: 'closed', streamId: 's1' });
    expect(closed).toHaveBeenCalledOnce();
    const chunks: string[] = [];
    handle.onData((d) => chunks.push(d));
    port.emit({ kind: 'data', streamId: 's1', data: 'late' });
    expect(chunks).toEqual([]);
  });

  it('installMachineResolver installs a resolver that returns undefined (not throws) for a machine it cannot build', () => {
    installMachineResolver();
    expect(state.resolver).toBeTypeOf('function');
    // No port installed: machineFor would throw; the resolver must swallow that.
    expect(state.resolver!('peer-abc')).toBeUndefined();
  });

  it('installMachineResolver resolves a real machine once a port is installed', () => {
    setRemoteMachinePort(fakePort());
    installMachineResolver();
    const machine = state.resolver!('peer-abc') as { id: string } | undefined;
    expect(machine?.id).toBe('peer-abc');
  });
});
