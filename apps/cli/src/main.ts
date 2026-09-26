/**
 * The `n10` executable. Each command loads only what it runs: `util` never
 * loads Ink, React or Electron, and the desktop is its own Electron process.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchDesktop } from './commands/launch-desktop.js';
import { parseArgs, USAGE, type Command } from './commands/parse-args.js';

// The package directory: its manifest and the desktop app sit beside this file.
const root = dirname(fileURLToPath(import.meta.url));

function packageVersion(): string {
  try {
    const manifest = readFileSync(join(root, 'package.json'), 'utf8');
    return (JSON.parse(manifest) as { version: string }).version;
  } catch {
    return 'dev';
  }
}

/** Resolves with the exit code, or `undefined` while the TUI runs. */
async function run(command: Command): Promise<number | undefined> {
  switch (command.kind) {
    case 'help':
      console.log(USAGE);
      return 0;
    case 'version':
      console.log(packageVersion());
      return 0;
    case 'util': {
      const { runUtil } = await import('./commands/util.js');
      await runUtil(command.args);
      return 0;
    }
    case 'tui': {
      const { runTui } = await import('./tui.js');
      await runTui(command.args);
      return undefined;
    }
    case 'desktop':
      return launchDesktop(root);
    case 'unknown':
      console.error(`n10: unknown argument '${command.arg}'\n\n${USAGE}`);
      return 2;
  }
}

const code = await run(parseArgs(process.argv.slice(2)));
if (code !== undefined) process.exit(code);
