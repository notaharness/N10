/**
 * Dev orchestrator for the desktop app:
 *   1. builds main + preload bundles with esbuild (watched)
 *   2. starts the Vite dev server for the renderer (HMR)
 *   3. launches Electron pointed at the dev server
 *   4. restarts Electron whenever a host-side bundle rebuilds;
 *      renderer changes hot-reload without a restart
 *
 * Run via `nx serve desktop`.
 */
import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const appRoot = join(workspaceRoot, 'apps', 'desktop');
const electronBin = join(workspaceRoot, 'node_modules', '.bin', 'electron');
const DEV_URL = 'http://localhost:5173';

// Must mirror the build-main nx target exactly: electron, node-pty and
// @notaharness/beam stay external, and the ESM output needs a require shim for them.
const REQUIRE_BANNER =
  'import { createRequire as __n10CreateRequire } from "node:module";' +
  'const require = __n10CreateRequire(import.meta.url);';

const mainOptions = {
  entryPoints: [
    join(appRoot, 'src/main/main.ts'),
    join(appRoot, 'src/main/tmux-session-worker.ts'),
    join(appRoot, 'src/main/beam-daemon-worker.ts'),
    join(appRoot, 'src/main/n10-shim.ts'),
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron', 'node-pty', '@notaharness/beam'],
  banner: { js: REQUIRE_BANNER },
  outdir: join(appRoot, 'dist/main'),
};

const preloadOptions = {
  entryPoints: [join(appRoot, 'src/preload/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  outfile: join(appRoot, 'dist/preload/preload.cjs'),
};

let electronProcess = null;

// npm-installed Electron often can't use its SUID sandbox (chrome-sandbox
// not root-owned 4755) — e.g. inside containers or unusual setups.
// Detect that and fall back to --no-sandbox rather than crashing.
function electronArgs() {
  const args = [];
  try {
    const st = statSync(
      join(workspaceRoot, 'node_modules', 'electron', 'dist', 'chrome-sandbox')
    );
    if (!(st.uid === 0 && (st.mode & 0o4755) === 0o4755)) {
      console.warn(
        '[desktop] SUID sandbox unavailable — launching with --no-sandbox (dev only)'
      );
      args.push('--no-sandbox');
    }
  } catch {
    args.push('--no-sandbox');
  }
  return args;
}

async function startElectron() {
  const previous = electronProcess;
  electronProcess = null;
  if (previous && previous.exitCode === null && previous.signalCode === null) {
    // It stops its beam daemon before exiting, and holds the
    // single-instance lock until it lets go of it.
    const exited = new Promise((resolve) => previous.once('exit', resolve));
    previous.kill();
    await exited;
  }
  electronProcess = spawn(electronBin, [...electronArgs(), '.'], {
    cwd: appRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      N10_VITE_URL: DEV_URL,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
}

// Initial full build so Electron has something to load.
await build(mainOptions);
await build(preloadOptions);

// Load the app's vite.config.ts explicitly — Vite only auto-discovers a
// config in `root`, and ours lives one level up. Without it the
// Tailwind + React plugins are missing and the renderer loads unstyled.
// `root` is passed absolutely too: the config's relative root would
// otherwise resolve against process.cwd() (the workspace root).
const vite = await createServer({
  configFile: join(appRoot, 'vite.config.ts'),
  root: join(appRoot, 'src/renderer'),
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
await vite.listen();
console.log('[desktop] vite dev server on ' + DEV_URL);

// esbuild's context.watch() takes no callback — rebuild notifications
// come from an onEnd plugin. main + preload usually finish within a few
// ms of each other, so restarts are debounced into one. Initial builds
// (before the first watch rebuild) do not restart: startElectron() below
// handles the first launch.
let restartTimer = null;
let initialBuilds = 0;
function scheduleRestart(label) {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    console.log(`[desktop] ${label} bundle changed — restarting electron…`);
    startElectron().catch((err) =>
      console.error('[desktop] restart failed', err)
    );
  }, 250);
}
function restartOnRebuild(label) {
  return {
    name: 'n10-restart-electron',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error(`[desktop] ${label} build failed — not restarting`);
          return;
        }
        if (initialBuilds < 2) {
          initialBuilds += 1; // first onEnd per context is the initial build
          return;
        }
        scheduleRestart(label);
      });
    },
  };
}
const contexts = [];
async function watch(options, label) {
  const ctx = await context({
    ...options,
    plugins: [...(options.plugins ?? []), restartOnRebuild(label)],
  });
  contexts.push(ctx);
  await ctx.watch();
}
await watch(mainOptions, 'main');
await watch(preloadOptions, 'preload');

await startElectron();

process.on('SIGINT', () => {
  electronProcess?.kill();
  void vite.close();
  for (const ctx of contexts) void ctx.dispose();
  process.exit(0);
});
