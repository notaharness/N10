import { describe, it, expect } from 'vitest';
import { loadRetryDelay } from './window-diagnostics.js';

describe('loadRetryDelay', () => {
  it('doubles from one second and settles at ten', () => {
    expect([1, 2, 3, 4, 5, 6].map(loadRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 10_000, 10_000,
    ]);
  });
});
