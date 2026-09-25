/**
 * What the app learns about how it was started: which build it is,
 * where it was opened, and the PATH its user's shell would have given
 * it. The npm package's `n10` starts it from a shell with
 * `N10_START_DIR` set; an installed app is started by a desktop menu,
 * the Dock or a terminal, with nothing but its arguments.
 */
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';

/** The dev build's name, from apps/desktop's private manifest. The npm
 *  package and the installers are named `n10`. */
const DEV_APP_NAME = 'n10-dev';

export interface AppIdentity {
  /** The release, `dev`, or the label a test or QA run gives itself
   *  in `N10_DESKTOP_VERSION`. */
  version: string;
  /** Gets the dev menu: reload and developer tools. */
  isDev: boolean;
}

/** `name` and `manifestVersion` are `app.getName()` and
 *  `app.getVersion()`, read from the manifest Electron runs. */
export function appIdentity(
  name: string,
  manifestVersion: string,
  env: NodeJS.ProcessEnv
): AppIdentity {
  const version =
    env.N10_DESKTOP_VERSION ||
    (name === DEV_APP_NAME ? 'dev' : manifestVersion);
  return { version, isDev: Boolean(env.N10_VITE_URL) || version === 'dev' };
}

/**
 * The directory to open first, or undefined to restore the last repo.
 * `N10_START_DIR`, when set, decides (empty means none). An installed
 * app opens the last path argument it was given, else the directory a
 * terminal started it in; a desktop menu's cwd, the home directory,
 * says nothing about what to open.
 */
export function launchStartDir(launch: {
  env: NodeJS.ProcessEnv;
  /** `process.argv`: the executable, then the arguments. */
  argv: readonly string[];
  cwd: string;
  packaged: boolean;
  fromTerminal: boolean;
}): string | undefined {
  const { env, argv, cwd } = launch;
  if (env.N10_START_DIR !== undefined) return env.N10_START_DIR || undefined;
  if (!launch.packaged) return undefined;
  const path = argv
    .slice(1)
    .reverse()
    .find((arg) => arg !== '' && !arg.startsWith('-'));
  if (path) return resolve(cwd, path);
  return launch.fromTerminal ? cwd : undefined;
}

const MARK = '__N10_LOGIN_ENV__';
/** Prints MARK without the command line containing it, which an
 *  inherited variable can echo back into the output. */
const PRINT_MARK = `printf '%s%s\\n' ${MARK.slice(0, 5)} ${MARK.slice(5)}`;

/** PATH from `env` output printed between two marks, which keep
 *  whatever the shell's startup files print out of it. */
export function pathFromEnvOutput(stdout: string): string | undefined {
  const body = stdout.split(MARK)[1];
  const line = body?.split('\n').find((l) => l.startsWith('PATH='));
  return line?.slice('PATH='.length) || undefined;
}

/** `first`'s entries, then those of `rest` it lacks. */
export function mergePath(first: string, rest: string): string {
  const entries = [...first.split(':'), ...rest.split(':')].filter(Boolean);
  return [...new Set(entries)].join(':');
}

/**
 * The PATH `shell` sets up as an interactive login shell, where users
 * put tmux, `claude`, `codex` and `gh`. Undefined when the shell fails
 * or takes longer than `timeoutMs`.
 */
export function loginShellPath(
  shell: string,
  timeoutMs = 5000
): Promise<string | undefined> {
  return new Promise((done) => {
    const child = execFile(
      shell,
      ['-ilc', `${PRINT_MARK}; env; ${PRINT_MARK}`],
      { encoding: 'utf8', timeout: timeoutMs },
      (error, stdout) => done(error ? undefined : pathFromEnvOutput(stdout))
    );
    // An interactive shell reading its stdin would wait forever.
    child.stdin?.end();
  });
}

/** Puts the login shell's PATH ahead of the app's own, which a desktop
 *  menu or the Dock starts as little more than `/usr/bin:/bin`. */
export async function importLoginShellPath(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const shell = env.SHELL || userInfo().shell;
  if (!shell) return;
  const path = await loginShellPath(shell);
  if (path) env.PATH = mergePath(path, env.PATH ?? '');
  else console.warn(`[desktop] could not read PATH from ${shell}`);
}
