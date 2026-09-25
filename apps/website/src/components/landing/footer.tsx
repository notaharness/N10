import Link from 'next/link';
import { Logo } from '@/components/logo';

const links = [
  { text: 'Docs', href: '/docs' },
  { text: 'Beam', href: '/beam' },
  { text: 'Orchestra', href: '/orchestra' },
  { text: 'GitHub', href: 'https://github.com/notaharness/n10' },
  { text: 'llms.txt', href: '/llms.txt' },
];

export function Footer() {
  return (
    <footer className="border-fd-border border-t">
      <div className="text-fd-muted-foreground mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-4 py-10 text-sm">
        <div className="flex items-center gap-4">
          <Logo className="h-5 w-auto" />
          <span>Keep up with your agents&apos; pull requests</span>
          <span aria-hidden>·</span>
          <Link
            href="https://github.com/notaharness"
            className="hover:text-fd-foreground transition-colors"
          >
            a notaharness project
          </Link>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {links.map(({ text, href }) => (
            <Link
              key={href}
              href={href}
              className="hover:text-fd-foreground transition-colors"
            >
              {text}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
