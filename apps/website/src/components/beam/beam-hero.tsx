import Link from 'next/link';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { buttonVariants } from '@/components/ui/button';

export function BeamHero() {
  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop className="h-[520px]" />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 pt-20 pb-12 text-center sm:pt-28">
        <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
          @notaharness/beam
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Run agents where the power is
        </h1>
        <p className="text-fd-muted-foreground max-w-xl text-lg text-pretty">
          Pair your laptop with a powerful workstation or headless build box,
          then use it like it&apos;s local: open a real terminal, run one
          command, or send a message that waits for it to come back online. No
          SSH keys. No tunnels to configure.
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
    </section>
  );
}
