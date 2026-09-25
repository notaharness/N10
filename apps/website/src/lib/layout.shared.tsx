import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { GitHubIcon } from '@/components/github-icon';
import { Logo } from '@/components/logo';

/** Nav config shared by the landing page and the docs layout. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // Hovering the mark slides the 10 out of the n to show its own
      // colour; see src/components/logo.tsx.
      title: <Logo hover className="h-6 w-auto" />,
    },
    links: [
      {
        text: 'Documentation',
        url: '/docs',
      },
      {
        text: 'Beam',
        url: '/beam',
      },
      {
        text: 'Orchestra',
        url: '/orchestra',
      },
      {
        text: 'Roadmap',
        url: '/docs/roadmap',
      },
      {
        type: 'icon',
        label: 'GitHub',
        icon: <GitHubIcon className="size-[1.15em]" />,
        text: 'GitHub',
        url: 'https://github.com/notaharness/n10',
        external: true,
      },
    ],
  };
}
