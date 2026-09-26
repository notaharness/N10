import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Composite/emitDeclarationOnly libs make the workspace root
  // tsconfig.json unusable by Next — see tsconfig.app.json for why.
  typescript: {
    tsconfigPath: 'tsconfig.app.json',
  },
  images: {
    // Deployed on Cloudflare Workers via OpenNext; the default Next
    // image optimizer needs a Node/Vercel-shaped host it doesn't get
    // there. Assets are shipped pre-sized instead (see
    // scripts/convert-media.mjs).
    unoptimized: true,
  },
};

const withMDX = createMDX();

export default withMDX(config);
