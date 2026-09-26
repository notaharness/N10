import { describe, it, expect } from 'vitest';
import { ozonePlatform } from './window-watchdog.js';

describe('ozonePlatform', () => {
  it('reports the switch when one was given', () => {
    expect(ozonePlatform('x11', 'wayland', 'wayland-0')).toBe('x11');
  });

  it('reports a hint that is not auto', () => {
    expect(ozonePlatform('', 'wayland', undefined)).toBe('wayland');
  });

  it('resolves auto by whether a Wayland display is set', () => {
    expect(ozonePlatform('', undefined, 'wayland-0')).toBe('wayland (auto)');
    expect(ozonePlatform('', 'auto', undefined)).toBe('x11 (auto)');
  });
});
