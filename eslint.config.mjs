import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import importPlugin from 'eslint-plugin-import';
import vitest from '@vitest/eslint-plugin';
import ink from './tools/eslint-plugin-ink.mjs';

export default tseslint.config(
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    plugins: {
      react,
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    settings: { react: { version: '19.2' } },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      // Too aggressive for this codebase — common pattern after null checks and array access
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      'react/jsx-key': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/jsx-no-constructed-context-values': 'error',
      'react/self-closing-comp': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // react-hooks v7 is React Compiler analysis wearing a lint
      // plugin, and when the compiler cannot lower a function it
      // abandons it — every other rule in the plugin goes quiet for
      // that file, with no report. `todo` is the only rule that says
      // so, and `recommended` leaves it off, which is how two
      // render-phase ref writes sat under a rule set to `error`.
      'react-hooks/todo': 'warn',
      // Reassigning a parameter makes the caller's value and the
      // callee's diverge halfway down a function; measured at zero
      // before being turned on.
      'no-param-reassign': 'error',
      'import/no-cycle': ['error', { maxDepth: 3 }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/index'],
              message: 'No barrel imports — import from the concrete file.',
            },
          ],
        },
      ],
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            // @n10/core is the shell-agnostic half of the app: git,
            // worktrees, PTYs, config, providers and pure helpers. The
            // React layer (@n10/app-core) depends on it and never the
            // reverse, so a hook can never be reached from a git call.
            // This is a tag constraint rather than a comment because
            // the rule it replaces — "keep the TUI and desktop
            // converged" — was a paragraph in CLAUDE.md, and it did not
            // hold.
            {
              sourceTag: 'scope:core',
              notDependOnLibsWithTags: ['scope:app-core'],
            },
          ],
        },
      ],
    },
  },
  {
    // Size and shape budgets.
    //
    // Warnings, deliberately: the codebase predates them and the point
    // is a downward ratchet, not a wall. They exist mostly to bound
    // what gets *added* — a file grows past 300 lines and a function
    // past 20 branches one plausible-looking edit at a time, and that
    // is the growth nobody reviews as growth.
    //
    // `complexity` is a ratchet, tightened only after the offenders it
    // would flag have actually been cleared. It opened at 20 with 21
    // functions over, when the worst were the TUI's three `*-input.ts`
    // keyboard handlers at 89, 52 and 49 — if-chains over resolved
    // action ids, which is a lookup table written as control flow. All
    // three are dispatch tables now and score 10, 3 and 4, so the ceiling
    // comes down a notch to 18.
    //
    // 14 functions are over it now, none of them in the desktop review
    // components — those came down when PrWorkspace's decisions moved
    // into lib/review-model.ts. What is left is spread across both
    // shells and three libs, with the worst four between 25 and 27:
    // handleSettingsInput, buildFlatDiff, the tabs reducer and
    // handlePlanCheckoutInput. Measure before the next notch rather
    // than guessing at it.
    // The glob is `**/` and not `apps/**` on purpose. The three e2e
    // projects build their config by spreading this one, and ESLint
    // re-bases a relative glob onto the config that spreads it — so
    // `apps/**` becomes `apps/cli-e2e/apps/**` there and matches
    // nothing. Every budget below, and the whole type-aware block,
    // silently did not apply to ~8k lines of Playwright suites. An
    // unanchored glob survives the re-basing.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'max-lines': [
        'warn',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      complexity: ['warn', { max: 12 }],
      'max-depth': ['error', 4],
    },
  },
  {
    // These files are large because the thing they describe is large: a
    // REST surface, an action catalog, and the desktop's whole bridge
    // API + IPC channel map (contract-*.ts already splits every
    // subject's *types* out; the single N10HostApi interface and IPC
    // const are what "single source of truth" means and stay here).
    // Splitting any of them spreads a single lookup table across files
    // without making any part of it easier to read, so they get a
    // ceiling instead of an exemption.
    files: [
      'libs/vcs/*/src/lib/provider.ts',
      'libs/core/src/lib/keybindings/registry.ts',
      'apps/desktop/src/host/contract.ts',
    ],
    rules: {
      'max-lines': [
        'warn',
        { max: 900, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // A long spec file is usually a well-covered unit, not a design
    // problem — the cases are independent and splitting them by line
    // count separates a behaviour from its siblings. Complexity still
    // applies: a branchy test is a test whose own correctness is in
    // question.
    files: ['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
    },
  },
  {
    // Type-aware rules. These need the TS program, which costs about
    // 19s across the workspace — worth it, because everything here is
    // a failure that types alone do not catch and review reliably
    // misses.
    //
    // `no-floating-promises` is the reason this block exists: n10 is
    // almost entirely async git, PTY and provider calls, and a dropped
    // promise there is a silent no-op followed by an unhandled
    // rejection. `ignoreVoid` keeps deliberate fire-and-forget
    // expressible — write `void doThing()` and the intent is on the
    // page instead of in the author's head.
    // Unanchored for the same reason as the budgets above: an
    // `apps/*/src/**` glob does not survive being spread into
    // apps/cli-e2e/eslint.config.mjs, and a Playwright suite is the
    // last place you want floating promises going unchecked.
    files: ['**/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'warn',
        { ignoreVoid: true, ignoreIIFE: true },
      ],
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'warn',
      // Adding a member to a union and forgetting one of the switches
      // that reads it is the single most common way a feature half
      // lands here. A `default` clause counts as handling it.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'warn',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // The five below were measured at zero before being turned on,
      // so they cost nothing today and only bound what gets added.
      // `no-unsafe-call` is the one with teeth: it is the last step of
      // an `any` escaping a JSON.parse or an untyped module and being
      // invoked, which types alone will not stop.
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/consistent-type-exports': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      // `in-try-catch` only requires the await where dropping it
      // changes behaviour — returning a promise from inside `try`
      // escapes the `catch` that was written to handle it.
      '@typescript-eslint/return-await': ['warn', 'in-try-catch'],
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Browser and Node APIs get deprecated under us; this reports it
      // at the call site instead of in a changelog nobody reads.
      '@typescript-eslint/no-deprecated': 'warn',
    },
  },
  {
    // The React Compiler's known blind spots, listed rather than left
    // silent.
    //
    // It cannot lower `try/finally` (nor a conditional inside
    // `try/catch`, nor some member-expression reorders), and when it
    // gives up on a function every react-hooks rule gives up with it.
    // These six files are therefore unanalysed: `refs`,
    // `set-state-in-render`, `purity` and the rest report nothing
    // here no matter what the code does. Two render-phase ref writes
    // in usePolling and useRemoteComments are live examples.
    //
    // The code is right as written — `finally` is the correct way to
    // release a loading flag — so the list is the honest artifact,
    // not a refactor. `react-hooks/todo` stays on everywhere else, so
    // a *new* file that lands in this state is reported rather than
    // joining the list quietly.
    files: [
      'apps/desktop/src/renderer/components/settings/FieldRow.tsx',
      'apps/desktop/src/renderer/components/terminal/SessionTerminal.tsx',
      'apps/desktop/src/renderer/screens/RepoOpen.tsx',
      'libs/app-core/src/lib/hooks/useDiffData.ts',
      'libs/app-core/src/lib/hooks/usePolling.ts',
      'libs/app-core/src/lib/hooks/useRemoteComments.ts',
    ],
    rules: {
      'react-hooks/todo': 'off',
    },
  },
  {
    // @n10/core is rendered *over*, never *with*. Importing React
    // here is how the boundary erodes: a pure sequence grows a
    // useCallback, and from then on the other shell cannot call it
    // without reimplementing it — which is how the TUI and the desktop
    // ended up with two copies of worktree deletion that had silently
    // diverged.
    //
    // Anything that needs React belongs in @n10/app-core, which
    // depends on this library. The plan store is the worked example:
    // the store is here, its useSyncExternalStore binding is there.
    files: ['libs/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                '@n10/core is shell-agnostic and must not import React. ' +
                'Put the hook or context in @n10/app-core and keep the ' +
                'logic here.',
            },
          ],
          patterns: [
            {
              group: ['react-dom', 'ink', 'electron', '@n10/app-core'],
              message:
                '@n10/core must not depend on a shell or on the React ' +
                'layer. Invert the dependency: the shell calls core.',
            },
            // Restated from the workspace block, not inherited: flat
            // config replaces a rule's options rather than merging
            // them, so declaring no-restricted-imports here drops
            // whatever the outer block set. Anything added there has
            // to be added here too.
            {
              group: ['**/index'],
              message: 'No barrel imports — import from the concrete file.',
            },
          ],
        },
      ],
    },
  },
  {
    // Ink enforces its layout contract at runtime by throwing, so a
    // component that breaks it type-checks, builds, ships, and takes
    // down the TUI the first time that branch renders. See
    // tools/eslint-plugin-ink.mjs for why these are local rules.
    //
    // Both layout rules are clean today and stay that way: they cost
    // nothing now and catch a class of crash that is otherwise found
    // by a user.
    files: ['apps/cli/src/**/*.{ts,tsx}', 'libs/app-core/src/**/*.{ts,tsx}'],
    plugins: { ink },
    rules: {
      'ink/no-raw-text': 'error',
      'ink/no-layout-inside-text': 'error',
      'ink/no-bare-process-exit': 'error',
    },
  },
  {
    // The entry point owns shutdown, and `n10 util` subcommands are
    // plain CLI with no Ink tree to unmount. Exiting the process is
    // their job; the rule is about components reaching for it.
    files: ['apps/cli/src/main.tsx', 'apps/cli/src/commands/**/*.ts'],
    rules: {
      'ink/no-bare-process-exit': 'off',
    },
  },
  {
    // React rules that apply wherever we render. Unanchored glob, as
    // above.
    //
    // `no-array-index-key` only sees an index that arrives as a
    // `.map()` parameter — a hand-rolled loop counter used as a key
    // reads as an ordinary variable and slips past it. Treat a clean
    // run as "no obvious ones", not "none".
    files: ['**/*.tsx'],
    rules: {
      'react/no-array-index-key': 'warn',
      'react/jsx-no-useless-fragment': 'warn',
    },
  },
  {
    // DOM-only rules: the desktop renderer is the one place with real
    // HTML elements. A <button> without an explicit type defaults to
    // `submit`, which inside a form navigates instead of doing what
    // the handler says.
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'react/button-has-type': 'warn',
      'react/jsx-no-target-blank': 'error',
    },
  },
  {
    // Unit tests (`*.spec.*`, vitest). The e2e suites are Playwright
    // and get the equivalent guards from eslint-plugin-playwright in
    // their own configs.
    //
    // `no-focused-tests` is the one that matters: a stray `.only`
    // leaves CI green while running a single test, which is worse than
    // a red build because nothing signals it.
    files: ['**/*.spec.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/valid-expect': 'error',
      'vitest/valid-describe-callback': 'error',
      'vitest/require-to-throw-message': 'off',
      'vitest/expect-expect': 'warn',
      'vitest/no-conditional-expect': 'warn',
      'vitest/no-standalone-expect': 'warn',
    },
  },
  {
    // Build/release scripts are workspace tooling, not application
    // code: they run from the repo root with plain node and are meant
    // to reach shared helpers there (e.g. scripts/shared-version.mjs).
    // The module-boundary rule guards the app/lib dependency graph,
    // which these files are not part of.
    files: ['apps/*/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
  {
    // The desktop renderer is a sandboxed browser context: no Node, no
    // `require`. Importing a *value* from a library that touches
    // node:fs (or a native module) pulls that builtin into the bundle,
    // where it cannot work — the dev server happily serves it and the
    // window renders black on launch, with the real cause buried in a
    // Vite warning. Types are erased at compile time and stay allowed,
    // which is how the renderer already consumes these libraries.
    //
    // Anything the renderer genuinely needs at runtime belongs behind
    // the host bridge (src/host/contract.ts) or in a browser-safe entry
    // point, the way @n10/vcs-core exposes its `./types` subpath and
    // @n10/core its `./plan` one.
    //
    // The `patterns` block is what keeps that list honest. Blocking the
    // package names alone left every subpath of them wide open, so a
    // `@n10/core/session` import would have sailed through and taken
    // node:child_process with it. Subpaths are blocked as a group and
    // the browser-safe ones named back in, which makes adding another
    // one a deliberate edit here rather than a silent import.
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            '@n10/app-core',
            '@n10/core',
            '@n10/logger',
            '@n10/review-comments',
            '@n10/terminal-pty',
            '@n10/terminal-tmux',
            '@n10/vcs-core',
            '@n10/vcs-github',
            '@n10/worktree-manager',
          ].map((name) => ({
            name,
            allowTypeImports: true,
            message:
              `${name} runs on Node and cannot be imported for its values ` +
              'in the sandboxed renderer. Use `import type`, go through ' +
              'window.n10, or import a browser-safe subpath.',
          })),
          patterns: [
            {
              group: [
                '@n10/*/*',
                // Browser-safe by construction, and tested as such.
                '!@n10/core/plan',
                '!@n10/app-core/plan',
                '!@n10/vcs-core/types',
                '!@n10/review-comments/conventional',
              ],
              allowTypeImports: true,
              message:
                'Only explicitly browser-safe @n10 subpaths may be ' +
                'imported for their values in the sandboxed renderer. ' +
                'Add one to the allowed list here only once it is free ' +
                'of node: builtins and native modules.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out-tsc',
      'tmp',
      '.claude/worktrees',
      '**/.tui-test',
      '**/eslint.config.mjs',
    ],
  }
);
