import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';

/** Nav config shared by the landing page and the docs layout. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // Hovering the mark slides the 10 out of the N to show its own
      // colour; see src/components/logo.tsx.
      title: <Logo hover className="h-6 w-auto" />,
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
