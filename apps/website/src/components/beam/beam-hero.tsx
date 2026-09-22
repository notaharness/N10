import Link from 'next/link';
import { BeamMesh } from '@/components/beam/mesh/beam-mesh';
import { buttonVariants } from '@/components/ui/button';

export function BeamHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-x-10 gap-y-12 px-4 pt-16 pb-24 sm:pt-24 lg:grid-cols-[1fr_1.2fr]">
        <div className="relative z-10 flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
          <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
            @notaharness/beam
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-5xl xl:text-6xl">
            Run agents on another machine
          </h1>
          <p className="text-fd-muted-foreground max-w-xl text-lg text-pretty">
            Pair your laptop with a workstation or headless build box. Open a
            terminal, run a command or queue a message without setting up SSH
            keys or tunnels.
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
        </div>
        <BeamMesh className="mx-auto w-full max-w-xl lg:max-w-none" />
      </div>
      {/* The mesh draws its ground out past its own box; this lets the
          rays sink into the page instead of stopping at the section's
          edge. */}
      <div
        aria-hidden
        className="to-fd-background pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent"
      />
    </section>
  );
}
