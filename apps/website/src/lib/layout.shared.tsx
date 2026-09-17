import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/** Nav config shared by the landing page and the docs layout. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'n10',
    },
    links: [
      {
        text: 'Documentation',
        url: '/docs',
      },
      {
        text: 'GitHub',
        url: 'https://github.com/notaharness/n10',
        external: true,
      },
    ],
  };
}
