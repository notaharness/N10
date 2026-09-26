import { setThemePreference } from '../lib/theme.js';
import { scheduler } from './programs/scheduler.js';

/**
 * The page embedding the demo drives two things: whether the scripted
 * agents play (paused off screen, or by the viewer), and the theme,
 * which follows the page's. Messages come from the embedder only, and
 * only these two are acted on.
 */
interface EmbedMessage {
  type: 'n10-demo';
  playing?: boolean;
  theme?: 'light' | 'dark';
}

function isEmbedMessage(data: unknown): data is EmbedMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'n10-demo'
  );
}

/**
 * The embedding page's theme at boot, so the first paint already
 * matches it: read off the page itself (the demo is served from the
 * same origin), or from `?theme=` when opened on its own.
 */
export function requestedTheme(): 'light' | 'dark' | null {
  try {
    if (window.parent !== window) {
      return window.parent.document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light';
    }
  } catch {
    // A cross-origin embedder: wait for its message instead.
  }
  const theme = new URLSearchParams(window.location.search).get('theme');
  return theme === 'light' || theme === 'dark' ? theme : null;
}

export function listenToEmbedder(): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !isEmbedMessage(event.data)) return;
    const { playing, theme } = event.data;
    if (typeof playing === 'boolean') scheduler.setPlaying(playing);
    if (theme === 'light' || theme === 'dark') setThemePreference(theme);
  });
}
