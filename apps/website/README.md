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

## The palette

`src/app/global.css` maps a few `--color-fd-*` variables (Fumadocs' own
token namespace) onto the same hex values as
`apps/desktop/src/renderer/styles.css`, so the site's accent matches the
desktop app. It's a copy, not a shared import — see the comment in that file
for why, and the note there about when to extract a shared `libs/design-tokens`.
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

## Deploying

`wrangler.jsonc`'s `routes` entry is commented out until `n10.is` is added
as a zone in the Cloudflare account. See the plan doc for the full Cloudflare
setup (custom domain, API token scopes, GitHub secrets) and the CI workflow
that runs `deploy:check` unconditionally and the real `deploy` once
`CLOUDFLARE_API_TOKEN` exists.
