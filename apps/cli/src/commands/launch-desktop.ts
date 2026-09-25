import { spawn } from 'node:child_process';
import { existsSync, statSync, type Stats } from 'node:fs';
import { createRequire } from 'node:module';
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
  // The electron package's main export is the path to its binary.
  const electron = createRequire(import.meta.url)('electron') as string;
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
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}
