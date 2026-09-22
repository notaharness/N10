import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  pollerFor,
  requireMachine,
  resolveMachine,
  setMachineResolver,
} from './machine-registry.js';
import type { RemoteMachine } from '@n10/terminal-tmux';

function fakeMachine(id: string): RemoteMachine {
  return {
    id,
    executor: { run: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })) },
    ptyOpener: { open: vi.fn() },
  };
}

describe('machine-registry', () => {
  afterEach(() => {
    setMachineResolver(null);
  });

  it('resolves "local" to undefined without consulting the installed resolver', () => {
    const resolver = vi.fn();
    setMachineResolver(resolver);
    expect(resolveMachine('local')).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('resolves a remote id through the installed resolver', () => {
    const machine = fakeMachine('peer-abc');
    setMachineResolver((id) => (id === 'peer-abc' ? machine : undefined));
    expect(resolveMachine('peer-abc')).toBe(machine);
  });

  it('requireMachine throws rather than returning undefined for an unresolved machine', () => {
    setMachineResolver(() => undefined);
    expect(() => requireMachine('peer-abc')).toThrow(/not available/);
  });

  it('requireMachine throws when no resolver has been installed at all', () => {
    expect(() => requireMachine('peer-abc')).toThrow(/not available/);
  });

  it('caches one poller per machine id, reused across calls', () => {
    const machine = fakeMachine('peer-abc');
    const a = pollerFor(machine);
    const b = pollerFor(machine);
    expect(a).toBe(b);
    a.dispose();
  });

  it('drops cached pollers when a new resolver is installed', () => {
    const machine = fakeMachine('peer-abc');
    const a = pollerFor(machine);
    setMachineResolver(() => machine);
    const b = pollerFor(machine);
    expect(a).not.toBe(b);
  });
});
