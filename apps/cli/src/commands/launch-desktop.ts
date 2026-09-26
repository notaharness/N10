import { spawn } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  statSync,
  type Stats,
} from 'node:fs';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Electron's setuid sandbox helper works only when root owns it with the
 * setuid bit. An npm install leaves it owned by the user, and Electron then
 * aborts with SIGTRAP, so the app runs unsandboxed instead.
 */
export function sandboxArgs(
  electron: string,
  platform: NodeJS.Platform = process.platform,
  stat: (path: string) => Pick<Stats, 'uid' | 'mode'> = statSync
): string[] {
  if (platform !== 'linux') return [];
  try {
    const helper = stat(join(dirname(electron), 'chrome-sandbox'));
    if (helper.uid === 0 && (helper.mode & 0o4755) === 0o4755) return [];
  } catch {
    // No helper: nothing to sandbox with.
  }
  return ['--no-sandbox'];
}

/** A shell's exit status for how Electron ended: its code, or 128 plus
 *  the signal that killed it (SIGTRAP when the sandbox aborts). */
export function exitStatus(
  code: number | null,
  signal: NodeJS.Signals | null
): number {
  if (code !== null) return code;
  return signal ? 128 + constants.signals[signal] : 1;
}

/**
 * Why requiring the electron package failed: it is missing, or its
 * first-run download failed, which Electron has already explained on
 * stderr. A root-owned install (`sudo npm install -g`) cannot download
 * as the user, so that case names the one-time fix.
 */
export function electronFailure(
  error: unknown,
  resolveElectron: () => string,
  writable: (dir: string) => boolean = isWritable
): string {
  if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
    return 'n10: Electron is not installed. Reinstall @notaharness/n10, or run `n10 --tui`.';
  }
  const dir = dirname(resolveElectron());
  if (!writable(dir)) {
    return `n10: cannot download Electron into ${dir}. Run \`sudo node ${join(
      dir,
      'install.js'
    )}\` once, or run \`n10 --tui\`.`;
  }
  return 'n10: could not download Electron. Check your connection and run `n10` again, or run `n10 --tui`.';
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs Electron on the app in `root`, the package directory, whose manifest
 * names `desktop/main/main.js` as the main script. Resolves with Electron's
 * exit code.
 */
export function launchDesktop(root: string, version: string): Promise<number> {
  if (!existsSync(join(root, 'desktop', 'main', 'main.js'))) {
    console.error(
      'n10: this build has no desktop app. From source, run `npx nx serve desktop`.'
    );
    return Promise.resolve(1);
  }
  const require = createRequire(import.meta.url);
  let electron: string;
  try {
    // The electron package's main export is the path to its binary,
    // which it downloads the first time it is required.
    electron = require('electron') as string;
  } catch (error) {
    console.error(electronFailure(error, () => require.resolve('electron')));
    return Promise.resolve(1);
  }
  const args = sandboxArgs(electron);
  if (args.length > 0) {
    console.warn(
      '[n10] SUID sandbox unavailable — launching with --no-sandbox'
    );
  }
  const child = spawn(electron, [...args, root], {
    stdio: 'inherit',
    // Launching from inside a repo opens that repo.
    env: {
      ...process.env,
      N10_START_DIR: process.cwd(),
      N10_DESKTOP_VERSION: version,
    },
  });
  return new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`n10: could not start Electron: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code, signal) => resolve(exitStatus(code, signal)));
  });
}
