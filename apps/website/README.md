# n10 website

The landing page and documentation for n10, at [n10.is](https://n10.is).
Next.js 16 (App Router) + [Fumadocs](https://fumadocs.dev), deployed to
Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare).

## Commands

```sh
npx nx dev website           # http://localhost:3100
npx nx build website         # OpenNext build -> .open-next/
npx nx typecheck website
npx nx lint website
npx nx preview website       # real workerd runtime, http://localhost:8787
npx nx run website:deploy:check   # wrangler --dry-run, no credentials needed
npx nx run website:deploy         # needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
```

`sync-content` (Fumadocs' MDX codegen into `.source/`) runs automatically as
a dependency of `dev`, `build` and `typecheck`.

## Conventions that differ from the rest of the repo

- **Imports are extensionless.** The workspace's `tsconfig.base.json` uses
  `moduleResolution: "nodenext"`, which is why other projects write
  `from '../../lib/utils.js'`. This project resolves with
  `moduleResolution: "bundler"` (required by Next) and does not extend the
  base tsconfig — see the comments in `tsconfig.json` and `tsconfig.app.json`.
- **`@/*` resolves to `./src/*`.** Declared only in this project's own
  `tsconfig.app.json`; the workspace has no path aliases elsewhere.
- **App code lives in `src/app/`, not `app/`.** The root ESLint config's
  type-aware rules only match `**/src/**`.
- **`next-env.d.ts` and `tsconfig.app.json`'s `jsx`/`include` fields are
  rewritten by Next itself** on `dev`/`build`/`typegen`. Don't hand-edit them
  back to something Next will just overwrite.

## The palette and type

`src/app/global.css` sets Fumadocs' `--color-fd-*` tokens from the two
colours of the mark (`src/components/logo.tsx`): the accent is sage taken
dark enough to carry white text, and the neutrals are warm greys leaning
toward sand. The raw brand colours are also exposed as `--n10-sage`,
`--n10-sand` and `--n10-mix` for decoration. The desktop app keeps its own
IDE palette; only `--radius` matches.

Type is Geist and Geist Mono through `next/font/google` (`src/app/layout.tsx`),
which downloads the files at build time and self-hosts them — the build
needs network access, the deployed site makes no request to Google.

Only two files are copied from the desktop app: `src/lib/cn.ts` and
`src/components/ui/button.tsx`. Fumadocs ships its own accordion, tabs,
callout, code block and search dialog — don't duplicate those.

## A build footgun: `NODE_ENV`

`scripts.build` is `NODE_ENV=production next build`, not plain `next build`.
If the ambient shell already has `NODE_ENV=development` set (true in some
dev-tooling environments), a bare `next build` can load a mixed
development/production React module graph partway through prerendering and
crash every route — including the synthetic `/_not-found` and
`/_global-error` pages — with `TypeError: Cannot read properties of null
(reading 'useContext')`. It reproduces on a stock, dependency-free Next 16
app, independent of anything in this project. Forcing `NODE_ENV=production`
in the script (rather than relying on the caller's environment) makes the
build deterministic regardless of how it's invoked.

## AI features

`/llms.txt` and `/llms-full.txt` are live (`src/app/llms.txt/route.ts`,
`src/lib/llms.ts`). The MCP endpoint (`/api/mcp`) and the "Ask AI" chat
dialog are not implemented yet: the version of `@fumadocs/cli` available
under this workspace's min-release-age constraint (`1.5.0`) doesn't ship
the `feature mcp` / `add ai/*` generators the newer Fumadocs docs describe.
Revisit once a newer CLI clears the cooldown, or hand-roll `/api/mcp` on
top of `source` and the Model Context Protocol SDK directly. The AI chat
dialog also needs a provider API key as a Worker secret before it's worth
adding.

## Deploying

The `Deploy website` workflow (`.github/workflows/deploy-website.yml`) runs
on every push to master. It always runs `deploy:check`, a wrangler dry run
that needs no credentials, and runs the real `deploy` once
`CLOUDFLARE_API_TOKEN` exists. To go live:

1. Add `n10.is` as a zone in the Cloudflare account.
2. Uncomment the `routes` entry in `wrangler.jsonc`. Until the zone exists,
   `wrangler deploy` fails on the unresolvable route.
3. Create an API token from Cloudflare's "Edit Cloudflare Workers" template,
   scoped to this account and the `n10.is` zone, and add it as the
   `CLOUDFLARE_API_TOKEN` repository secret.
4. Add the account ID as the `CLOUDFLARE_ACCOUNT_ID` repository variable.

## Media

`scripts/convert-media.mjs` re-encodes the GIFs in `docs/media/` into
`public/media/`. It needs ffmpeg and the output changes only when a demo is
re-recorded, so run it by hand and commit the result rather than making the
build depend on ffmpeg.
