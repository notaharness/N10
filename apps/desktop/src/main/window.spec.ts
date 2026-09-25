import { describe, it, expect } from 'vitest';
import {
  isAllowedNavigation,
  loadTarget,
  rendererWebPreferences,
  windowChrome,
} from './window.js';

describe('rendererWebPreferences', () => {
  it('never grants Node access to the renderer', () => {
    const prefs = rendererWebPreferences('/path/to/preload.cjs');
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
  });

  it('points the preload at the provided bridge script', () => {
    const prefs = rendererWebPreferences('/path/to/preload.cjs');
    expect(prefs.preload).toBe('/path/to/preload.cjs');
  });
});

describe('windowChrome', () => {
  it('uses a hidden title bar with native overlay controls', () => {
    const chrome = windowChrome(true);
    expect(chrome.titleBarStyle).toBe('hidden');
    expect(chrome.titleBarOverlay).toMatchObject({ height: 36 });
  });

  it('matches the overlay colour to the colour scheme', () => {
    const dark = windowChrome(true);
    const light = windowChrome(false);
    expect(dark.backgroundColor).not.toBe(light.backgroundColor);
    expect(dark.titleBarOverlay).not.toEqual(light.titleBarOverlay);
  });
});

describe('loadTarget', () => {
  it('prefers the dev server URL when one is set', () => {
    const target = loadTarget('http://localhost:5173', '/app/index.html');
    expect(target).toEqual({
      kind: 'dev-server',
      url: 'http://localhost:5173',
    });
  });

  it('falls back to the built index.html on disk', () => {
    const target = loadTarget(undefined, '/app/renderer/index.html');
    expect(target).toEqual({ kind: 'file', path: '/app/renderer/index.html' });
  });
});

describe('isAllowedNavigation', () => {
  const DEV = 'http://localhost:5173';

  it('allows the dev server origin in development', () => {
    expect(isAllowedNavigation('http://localhost:5173/index.html', DEV)).toBe(
      true
    );
  });

  it('rejects any other origin in development', () => {
    expect(isAllowedNavigation('https://evil.example/', DEV)).toBe(false);
    // Same host, different port is a different origin.
    expect(isAllowedNavigation('http://localhost:9999/', DEV)).toBe(false);
  });

  it('allows only file:// in the packaged app', () => {
    expect(
      isAllowedNavigation('file:///app/renderer/index.html', undefined)
    ).toBe(true);
    expect(isAllowedNavigation('https://evil.example/', undefined)).toBe(false);
  });

  it('rejects file:// while the dev server is in use', () => {
    expect(isAllowedNavigation('file:///etc/passwd', DEV)).toBe(false);
  });

  it('rejects non-http schemes and unparseable targets', () => {
    expect(isAllowedNavigation('javascript:alert(1)', DEV)).toBe(false);
    expect(isAllowedNavigation('not a url', DEV)).toBe(false);
    expect(isAllowedNavigation('', undefined)).toBe(false);
  });
});
