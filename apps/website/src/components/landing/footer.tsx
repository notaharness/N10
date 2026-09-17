import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <div className="text-fd-muted-foreground mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm">
        <span>n10 &mdash; run coding agents across git worktrees</span>
        <nav className="flex gap-4">
          <Link href="/docs">Docs</Link>
          <Link href="https://github.com/notaharness/n10">GitHub</Link>
        </nav>
      </div>
    </footer>
  );
}
