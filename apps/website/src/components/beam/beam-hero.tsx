import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function BeamHero() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-16 pb-8 text-center sm:pt-24">
      <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
        @notaharness/beam
      </span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Run your agents on another machine
      </h1>
      <p className="text-fd-muted-foreground max-w-xl text-lg">
        Pair your laptop with a beefier workstation or a headless build box, and
        reach it like it&apos;s local — a real terminal, a single command, or a
        message that waits until it comes back online. No SSH keys, no tunnels
        to set up.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/docs/beam" className={buttonVariants({ size: 'lg' })}>
          Read the docs
        </Link>
        <Link
          href="https://github.com/notaharness/n10"
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
        >
          GitHub
        </Link>
      </div>
    </section>
  );
}
