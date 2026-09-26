import Link from 'next/link';
import { OrchestraStage } from '@/components/orchestra/orchestra-stage';
import { buttonVariants } from '@/components/ui/button';

export function OrchestraHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 pt-12 pb-0 text-center sm:pt-16">
        <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
          orchestra@notaharness
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Delegate branch-sized tasks to other agents
        </h1>
        <p className="text-fd-muted-foreground max-w-2xl text-lg text-pretty">
          Orchestra gives one coding agent two skills for assigning work to
          others. Each player works in its own tmux session and Git worktree
          with Claude Code, Codex, Gemini, Copilot or OpenCode. It runs on this
          machine, and reaches your other machines through n10 Desktop or Beam.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="#install" className={buttonVariants({ size: 'lg' })}>
            Installation
          </Link>
          <Link
            href="https://github.com/notaharness/plugins/tree/main/orchestra"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            GitHub
          </Link>
        </div>
      </div>
      <OrchestraStage className="mx-auto w-full max-w-5xl px-4 pt-0 pb-8" />
    </section>
  );
}
