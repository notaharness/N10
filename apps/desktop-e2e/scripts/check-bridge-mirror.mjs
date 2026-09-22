/**
 * Proves `src/n10-window.d.ts` still describes the real host API.
 *
 * That file is a hand-written minimal view of the renderer's
 * `window.n10` bridge, kept minimal on purpose: the suite drives the
 * UI, not the API, and importing the app's source would couple the two
 * projects. Nothing was checking it, and it had drifted from
 * `N10HostApi` three times before a typecheck error finally pointed at
 * a test line that was correct.
 *
 * The check cannot live in either project's sources. `apps/desktop-e2e`
 * and `apps/desktop` are both `type:app`, which may depend only on
 * `type:lib`, so a reference either way is rejected by
 * `@nx/enforce-module-boundaries` and would add a TypeScript project
 * reference the workspace deliberately does not have. So it is done
 * here instead: a scratch project outside the graph that compiles the
 * contract and the mirror together with the assertions below. Nothing
 * checked in references across the boundary, and the types are erased
 * anyway — this costs the suite nothing at runtime.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const contract = join(root, 'apps/desktop/src/host/contract.ts');
const mirror = join(root, 'apps/desktop-e2e/src/n10-window.d.ts');

const assertions = `
/// <reference path=${JSON.stringify(mirror)} />
import type { N10HostApi } from ${JSON.stringify(contract)};

/** Fails unless \`Actual\` satisfies everything \`Declared\` claims. */
type Satisfies<Actual extends Declared, Declared> = Actual;
type AssertTrue<T extends true> = T;

/**
 * Fails unless every key \`Declared\` names still exists on \`Actual\`.
 *
 * \`Satisfies\` alone would not catch this: dropping an *optional* field
 * from the contract leaves the real type assignable to the mirror, so
 * the mirror would go on promising a field that is no longer there.
 */
type KeysExist<Declared, Actual> =
  Exclude<keyof Declared, keyof Actual> extends never ? true : false;

type Element<T> = T extends readonly (infer E)[] ? E : never;
type Returns<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

/** Every method the mirror declares, with a compatible signature. */
export type BridgeIsAViewOfTheHostApi = Satisfies<N10HostApi, N10Bridge>;

/** Per-record field checks for the listings whose fields tests read.
 *  Add a line when the mirror starts declaring another. */
export type TerminalFields = AssertTrue<KeysExist<
  Element<Returns<N10Bridge['listTerminals']>>,
  Element<Returns<N10HostApi['listTerminals']>>
>>;
export type SessionFields = AssertTrue<KeysExist<
  Element<Returns<N10Bridge['listSessions']>>,
  Element<Returns<N10HostApi['listSessions']>>
>>;
export type SettingsFields = AssertTrue<KeysExist<
  Element<Returns<N10Bridge['getSettingsView']>>,
  Element<Returns<N10HostApi['getSettingsView']>>
>>;
export type ForeignSessionFields = AssertTrue<KeysExist<
  Element<Returns<N10Bridge['listForeignSessions']>>,
  Element<Returns<N10HostApi['listForeignSessions']>>
>>;
export type WorktreeFields = AssertTrue<KeysExist<
  Element<Returns<N10Bridge['listWorktrees']>>,
  Element<Returns<N10HostApi['listWorktrees']>>
>>;
`;

const scratch = mkdtempSync(join(tmpdir(), 'n10-bridge-mirror-'));
try {
  writeFileSync(join(scratch, 'assertions.ts'), assertions);
  writeFileSync(
    join(scratch, 'tsconfig.json'),
    JSON.stringify({
      extends: join(root, 'tsconfig.base.json'),
      compilerOptions: {
        composite: false,
        declarationMap: false,
        emitDeclarationOnly: false,
        noEmit: true,
        lib: ['es2022', 'dom'],
        types: ['node'],
        // The contract reaches into the workspace's own packages.
        baseUrl: root,
        typeRoots: [join(root, 'node_modules/@types')],
      },
      files: ['assertions.ts'],
    })
  );
  // Run from the scratch dir so tsc prints `assertions.ts(line,col)`
  // rather than a path that climbs out of the repository.
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '-p', '.'],
    {
      cwd: scratch,
      stdio: 'inherit',
    }
  );
  console.log('bridge mirror matches the host contract');
} catch {
  console.error(
    '\nsrc/n10-window.d.ts no longer matches apps/desktop/src/host/contract.ts.\n' +
      'It is a hand-written view of the bridge: update it to match, or drop\n' +
      'what the suite no longer uses.'
  );
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
