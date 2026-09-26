import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

// The renderer as a web page, for the website's landing demo: the same
// app with `window.n10` answered by an in-page mock host instead of
// the preload (src/renderer/demo). Nothing here reaches a network.
//
// The root stays the renderer's own, because Tailwind finds the classes
// it generates by scanning from there; only the entry page differs, so
// the page lands at `demo/index.html` in the output.
const outDir = fileURLToPath(new URL('./dist/demo', import.meta.url));
const page = fileURLToPath(
  new URL('./src/renderer/demo/index.html', import.meta.url)
);

export default mergeConfig(
  base,
  defineConfig({
    build: { outDir, emptyOutDir: true, rollupOptions: { input: page } },
    server: { port: 5174 },
  })
);
