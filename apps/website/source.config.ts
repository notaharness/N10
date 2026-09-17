import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    // `preset` must be explicit: with it omitted, TS can't disambiguate
    // the two mdxOptions union members and picks the one (`'minimal'`,
    // plain @mdx-js/mdx ProcessorOptions) that doesn't allow the
    // append-function form of remarkPlugins below.
    preset: 'fumadocs',
    // Rewrites ```mermaid fences into a <Mermaid /> component reference;
    // the component itself is registered in src/components/mdx.tsx.
    // remarkMdxMermaid() returns a Transformer directly rather than a
    // unified attacher, so it's wrapped in a no-op attacher function to
    // match the Pluggable type unified expects in this array.
    remarkPlugins: (plugins) => [...plugins, () => remarkMdxMermaid()],
  },
});
