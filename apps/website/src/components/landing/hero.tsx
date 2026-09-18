import Link from 'next/link';
import { Logo } from '@/components/logo';
import { ThemeImage } from '@/components/theme-image';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-16 text-center sm:py-24">
      {/* Starts split and mixes on load; hover splits it again. */}
      <Logo intro hover className="h-20 w-auto sm:h-24" />
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Run coding agents across git worktrees
      </h1>
      <p className="text-fd-muted-foreground max-w-2xl text-lg">
        Track pull requests and review code from a desktop app or terminal UI.
        Each branch gets its own worktree and agent session, so you can keep
        several features in progress at once.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/docs/installation"
          className={buttonVariants({ size: 'lg' })}
        >
          Get started
        </Link>
        <Link
          href="https://github.com/notaharness/n10"
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
        >
          GitHub
        </Link>
      </div>
      <ThemeImage
        name="hero"
        alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments"
        className="mt-8 w-full max-w-4xl rounded-lg border border-fd-border shadow-lg"
      />
    </section>
  );
}
