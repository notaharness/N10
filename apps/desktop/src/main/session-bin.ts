/**
 * The directory every local session the desktop launches gets first on
 * its PATH (core's `setLocalSessionEnv`): `beam`, the binary the app
 * runs as its daemon, and `n10`, whose `util` subcommand review agents
 * call (`n10 util add-comment`) with this app's own code, whether or not
 * an `n10` is on the session's PATH.
 */
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** What the session bin's entries run. */
export interface SessionBinSources {
  /** The app's executable, run as Node (`ELECTRON_RUN_AS_NODE`). */
  runtime: string;
  /** The bundled `n10-shim.js`. */
  shim: string;
  /** The beam binary; no `beam` link without one. */
  beam?: string;
}

/** Marks a directory as a session bin, so no `n10` forwards to another. */
const MARKER = '.n10-session-bin';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** `n10 util` runs the bundled shim under the app's executable as Node.
 *  Anything else goes to the first `n10` on PATH outside a session bin —
 *  a global install, exec'd directly. */
function n10Script(src: SessionBinSources): string {
  const shim = [src.runtime, src.shim].map(shellQuote).join(' ');
  return `#!/bin/sh
if [ "$1" = util ]; then
  ELECTRON_RUN_AS_NODE=1 exec ${shim} "$@"
fi
set -f
IFS=:
for dir in $PATH; do
  if [ -f "$dir/n10" ] && [ -x "$dir/n10" ] && [ ! -e "$dir/${MARKER}" ]; then
    unset IFS
    exec "$dir/n10" "$@"
  fi
done
echo 'In n10 Desktop sessions this n10 runs only \`n10 util\`, and no other n10 is on PATH. Install @notaharness/n10 globally for the rest.' >&2
exit 1
`;
}

/** Replaces `path` in one step, so a session running it never sees it
 *  half-written or missing. */
function replace(path: string, write: (tmp: string) => void): void {
  const tmp = `${path}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  write(tmp);
  renameSync(tmp, path);
}

/** Rewrites the `n10` and `beam` entries in `dir`: paths in them name
 *  this install of the app. */
export function writeSessionBin(dir: string, src: SessionBinSources): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MARKER), '');
  replace(join(dir, 'n10'), (tmp) => {
    writeFileSync(tmp, n10Script(src));
    chmodSync(tmp, 0o755);
  });
  const beam = join(dir, 'beam');
  if (src.beam) {
    const target = src.beam;
    replace(beam, (tmp) => symlinkSync(target, tmp));
  } else {
    rmSync(beam, { force: true });
  }
}
