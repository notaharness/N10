import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './global.css';

// Exposed as CSS variables rather than class names so Tailwind's
// --font-sans / --font-mono (see global.css) pick them up everywhere,
// Fumadocs' own components included.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: {
    template: '%s | n10',
    default: "n10 | Keep up with your agents' pull requests",
  },
  description:
    'Run coding agents in Git worktrees and review their pull requests, and your colleagues’, in one place. Sessions are plain tmux.',
  metadataBase: new URL('https://n10.is'),
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
