import Link from 'next/link';

// Placeholder landing page. The real composition (hero, install strip,
// feature sections, provider table) lands in a later checkpoint once
// the docs content and converted demo media exist — see the plan's
// "feat(website): build the landing page" step.
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold">n10</h1>
      <p className="text-fd-muted-foreground max-w-md">
        Run AI coding agents across git worktrees, track pull requests, and
        review code from a desktop app or terminal UI.
      </p>
      <Link
        href="/docs"
        className="text-fd-primary underline underline-offset-4"
      >
        Read the docs
      </Link>
    </main>
  );
}
