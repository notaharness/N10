import { describe, it, expect } from 'vitest';
import { recoveryStep } from './window-watchdog.js';

describe('recoveryStep', () => {
  it('leaves a healthy window alone', () => {
    expect(recoveryStep('healthy', 0)).toBe('none');
    expect(recoveryStep('healthy', 2)).toBe('none');
  });

  it('crashes a hung renderer so the crash handler reloads it', () => {
    expect(recoveryStep('hung', 0)).toBe('crash');
    expect(recoveryStep('hung', 2)).toBe('crash');
  });

  it('escalates a window that produces no frames: repaint, reload, new window', () => {
    expect(recoveryStep('unpainted', 0)).toBe('repaint');
    expect(recoveryStep('unpainted', 1)).toBe('reload');
    expect(recoveryStep('unpainted', 2)).toBe('recreate');
  });

  it('stops after the last step rather than looping', () => {
    expect(recoveryStep('unpainted', 3)).toBe('give-up');
    expect(recoveryStep('hung', 3)).toBe('give-up');
  });
});
