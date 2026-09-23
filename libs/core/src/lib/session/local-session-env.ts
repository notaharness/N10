import { delimiter } from 'node:path';

/** PATH directories and variables every session launched on this
 *  machine gets, set by the program launching them. A remote session
 *  gets none: they are this machine's paths. */
let pathDirs: readonly string[] = [];
let vars: Readonly<Record<string, string>> = {};

export function setLocalSessionEnv(next: {
  pathDirs: readonly string[];
  env: Readonly<Record<string, string>>;
}): void {
  pathDirs = next.pathDirs;
  vars = next.env;
}

/** The variables a local session gets, and `basePath` with the PATH
 *  directories in front. */
export function localSessionEnv(basePath: string | undefined): {
  vars: Readonly<Record<string, string>>;
  path: string;
} {
  return {
    vars,
    path: [...pathDirs, ...(basePath ? [basePath] : [])].join(delimiter),
  };
}
