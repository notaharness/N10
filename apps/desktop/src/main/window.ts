import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Web preferences for the n10 renderer window.
 *
 * Security posture: the renderer is an untrusted web context (it
 * renders remote content like PR comments), so it gets no Node access
 * whatsoever and runs in the Chromium sandbox. All host capabilities
 * go through the typed preload bridge (see src/host/contract.ts); the
 * preload only needs `electron` (contextBridge/ipcRenderer), which
 * sandboxed preloads are allowed to require.
 */
export function rendererWebPreferences(
  preloadPath: string
): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

/** Title-bar / background chrome matched to the OS colour scheme so the
 *  first paint and the native window controls don't flash the wrong
 *  theme. Values mirror the renderer's `--titlebar` tokens. */
export function windowChrome(
  dark: boolean
): Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'titleBarStyle' | 'titleBarOverlay'
> {
  const bar = dark ? '#181818' : '#f8f8f8';
  const symbol = dark ? '#cccccc' : '#3b3b3b';
  return {
    backgroundColor: dark ? '#1f1f1f' : '#ffffff',
    titleBarStyle: 'hidden',
    // Match the renderer title bar's full 36px height; the bar draws
    // its divider as an inset shadow (not a border) so both sides
    // centre their controls on the same midline.
    titleBarOverlay: { color: bar, symbolColor: symbol, height: 36 },
  };
}

/**
 * Whether the renderer may navigate itself to `target`.
 *
 * Only the app's own origin is allowed: the dev server in development,
 * `file://` for the packaged build. Anything else — a dropped link, a
 * form submit, a `window.location` write from injected content — would
 * load a remote page **with the preload bridge still attached**, handing
 * it worktree removal, session spawn/write and the provider-backed
 * host calls. Off-site URLs open in the real browser instead
 * (see the `setWindowOpenHandler` in main.ts).
 *
 * Exported separately from the listener so the policy is unit-testable.
 */
export function isAllowedNavigation(
  target: string,
  devServerUrl: string | undefined
): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') return !devServerUrl;
  if (!devServerUrl) return false;
  try {
    return url.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/** Where the window loads its content from. */
export type LoadTarget =
  | { kind: 'dev-server'; url: string }
  | { kind: 'file'; path: string };

export function loadTarget(
  devServerUrl: string | undefined,
  indexHtmlPath: string
): LoadTarget {
  if (devServerUrl) {
    return { kind: 'dev-server', url: devServerUrl };
  }
  return { kind: 'file', path: indexHtmlPath };
}
