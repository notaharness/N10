import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { BOOT_MARKS, markOnce } from './lib/perf.js';
import { initTheme } from './lib/theme.js';
import './styles.css';
// The terminal stylesheet, taken from @wterm/dom rather than
// @wterm/react/css. The latter is one line — `@import
// "../../dom/src/terminal.css"` — a relative path that only resolves
// while npm happens to place the two packages side by side. As soon as
// anything else in the workspace wants the same version of @wterm/dom,
// npm hoists it to the root and that import has nowhere to point.
// @wterm/dom publishes the identical file under its own "./css" entry,
// which package resolution finds wherever the package ends up.
import '@wterm/dom/css';

markOnce(BOOT_MARKS.boot);

// Apply the persisted theme class before the first paint.
initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      label="n10 hit an error it could not draw past."
      reload={() => window.location.reload()}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>
);
