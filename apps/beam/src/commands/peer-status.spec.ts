import { describe, expect, it } from 'vitest';
import { describeState } from './peer-status.js';

describe('describeState', () => {
  it('words no-endpoint as a normal condition, never as an error', () => {
    const text = describeState('no-endpoint');
    expect(text).toContain('can reach us only');
    expect(text.toLowerCase()).not.toMatch(/error|fail|broken/);
  });

  it('renders each of the other four states distinctly', () => {
    const rendered = new Set(
      (['connected', 'reachable', 'unreachable', 'unknown'] as const).map(
        describeState
      )
    );
    expect(rendered.size).toBe(4);
  });
});
