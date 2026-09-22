import { describe, expect, it, vi } from 'vitest';
import { StreamRegistry } from './stream-registry.js';

describe('StreamRegistry', () => {
  it('resolves an exact name match', () => {
    const registry = new StreamRegistry();
    const handler = vi.fn();
    registry.register('exec', handler);
    expect(registry.resolve('exec')).toBe(handler);
  });

  it('resolves a colon-suffixed name against the prefix handler', () => {
    const registry = new StreamRegistry();
    const handler = vi.fn();
    registry.register('pty', handler);
    expect(registry.resolve('pty:bash')).toBe(handler);
  });

  it('returns undefined for a name with no registered handler', () => {
    const registry = new StreamRegistry();
    expect(registry.resolve('unknown')).toBeUndefined();
  });

  it('an exact match wins over falling back to a prefix', () => {
    const registry = new StreamRegistry();
    const exact = vi.fn();
    const prefix = vi.fn();
    registry.register('pty', prefix);
    registry.register('pty:bash', exact);
    expect(registry.resolve('pty:bash')).toBe(exact);
  });

  it('unregister removes a handler', () => {
    const registry = new StreamRegistry();
    registry.register('exec', vi.fn());
    registry.unregister('exec');
    expect(registry.resolve('exec')).toBeUndefined();
  });
});
