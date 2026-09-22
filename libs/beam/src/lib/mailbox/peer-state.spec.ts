import { describe, expect, it } from 'vitest';
import { derivePeerState } from './peer-state.js';

describe('derivePeerState', () => {
  it('a live connection is always connected, regardless of endpoints', () => {
    expect(derivePeerState({ endpoints: [] }, true)).toBe('connected');
    expect(derivePeerState({ endpoints: ['x'] }, true)).toBe('connected');
  });

  it('no endpoints and no connection is no-endpoint', () => {
    expect(derivePeerState({ endpoints: [] }, false)).toBe('no-endpoint');
  });

  it('an endpoint with no connection and no probe defaults to unknown, never a guessed reachable or unreachable (D4)', () => {
    expect(derivePeerState({ endpoints: ['x'] }, false)).toBe('unknown');
  });

  it('an explicit probe result is honored when not connected', () => {
    expect(derivePeerState({ endpoints: ['x'] }, false, 'reachable')).toBe(
      'reachable'
    );
    expect(derivePeerState({ endpoints: ['x'] }, false, 'unreachable')).toBe(
      'unreachable'
    );
  });
});
