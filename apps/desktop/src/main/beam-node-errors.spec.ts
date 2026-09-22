import { PeerKeyMismatchError } from '@n10/beam';
import { describe, expect, it, vi } from 'vitest';
import { classifyPairError, withTimeout } from './beam-node-errors.js';

describe('classifyPairError', () => {
  it('names a key mismatch, and carries the id and the label we already hold it under', () => {
    const error = new PeerKeyMismatchError('bbbbbbbbbbbbbbbb', 'old-workbox');
    const failure = classifyPairError(error);
    expect(failure.reason).toBe('key-mismatch');
    expect(failure.peerId).toBe('bbbbbbbbbbbbbbbb');
    expect(failure.existingLabel).toBe('old-workbox');
  });

  it('names an invalid pairing URL, missing the token fragment', () => {
    const failure = classifyPairError(
      new Error('pair URL carries no #token= fragment')
    );
    expect(failure.reason).toBe('invalid-url');
  });

  it('names an invalid pairing URL, not a URL at all', () => {
    const failure = classifyPairError(new TypeError('Invalid URL'));
    expect(failure.reason).toBe('invalid-url');
  });

  it('names an expired-or-spent token without claiming to distinguish them', () => {
    const failure = classifyPairError(
      new Error(
        'pairing failed (401): invalid, expired, or already-used pairing token'
      )
    );
    expect(failure.reason).toBe('invalid-token');
    expect(failure.message).not.toMatch(/something went wrong/i);
  });

  it('names a protocol mismatch', () => {
    const failure = classifyPairError(
      new Error('host speaks protocol 2, this client speaks 1')
    );
    expect(failure.reason).toBe('protocol-mismatch');
  });

  it('falls back to unreachable for anything else, e.g. a network failure', () => {
    const failure = classifyPairError(new TypeError('fetch failed'));
    expect(failure.reason).toBe('unreachable');
    expect(failure.message).toContain('fetch failed');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise wins the race', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects once the timeout elapses first', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => undefined);
      const result = withTimeout(never, 10);
      const advance = vi.advanceTimersByTimeAsync(10);
      await expect(result).rejects.toThrow('timed out');
      await advance;
    } finally {
      vi.useRealTimers();
    }
  });
});
