import Link from 'next/link';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { Logo } from '@/components/logo';
import { ThemeImage } from '@/components/theme-image';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop />
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-[calc(var(--n10-cell)*1)] pb-16 text-center sm:pb-24">
        {/* Starts split and mixes on load; hover splits it again. Two
            rows down and 7 cells wide about the centre, so every stroke
            of the mark is a cell of the backdrop's grid in both poses. */}
        <Logo intro hover className="n10-logo--grid" />
        <h1 className="mt-8 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Keep up with your agents&apos; pull requests
        </h1>
        <p className="text-fd-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
          Agents in worktrees, sessions in plain tmux, review in one place.
          Close n10 and your agents keep running; <code>tmux attach</code> still
          works.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/getting-started"
            className={buttonVariants({ size: 'lg' })}
          >
            Read the docs
          </Link>
          <Link
            href="https://github.com/notaharness/n10"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            GitHub
          </Link>
        </div>
        <p className="text-fd-muted-foreground mt-6 text-sm">
          n10, a{' '}
          <Link
            href="https://github.com/notaharness"
            className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
          >
            notaharness
          </Link>{' '}
          project
        </p>
        <div className="relative mt-10 w-full sm:mt-12">
          <div
            aria-hidden
            className="n10-stage-glow absolute inset-x-[6%] -top-6 bottom-[35%]"
          />
          <ThemeImage
            name="hero"
            alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments"
            className="n10-frame relative w-full rounded-xl"
          />
        </div>
      </div>
    </section>
  );
}
