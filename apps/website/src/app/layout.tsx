import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata: Metadata = {
  title: {
    template: '%s | n10',
    default: 'n10 — run coding agents across git worktrees',
  },
  description:
    'Run AI coding agents across git worktrees, track pull requests, and review code from a desktop app or terminal UI.',
  metadataBase: new URL('https://n10.is'),
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
