import Link from 'next/link';
import { OrchestraStage } from '@/components/orchestra/orchestra-stage';
import { buttonVariants } from '@/components/ui/button';

export function OrchestraHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 pt-16 pb-4 text-center sm:pt-24">
        <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
          orchestra@notaharness
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          One agent conducts. The rest play.
        </h1>
        <p className="text-fd-muted-foreground max-w-2xl text-lg text-pretty">
          Orchestra is a pair of skills that let one coding agent hand work to
          others. The orchestrator splits a backlog into branch-sized tasks;
          each player takes one, in its own tmux session and Git worktree, and
          reports back as it goes. Works with Claude Code and Codex, on this
          machine or, with Beam, on any machine you&apos;ve paired.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="#install" className={buttonVariants({ size: 'lg' })}>
            Install the plugin
          </Link>
          <Link
            href="https://github.com/notaharness/plugins/tree/main/orchestra"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            GitHub
          </Link>
        </div>
      </div>
      <OrchestraStage className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8" />
    </section>
  );
}
