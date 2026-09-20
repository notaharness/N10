import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { buttonVariants } from '@/components/ui/button';

const INSTALL = 'npm install -g @notaharness/beam';

export function BeamCta() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pt-8 pb-24">
      <div className="border-fd-border bg-fd-card relative overflow-hidden rounded-2xl border px-6 py-16 text-center">
        <HeroBackdrop cells={false} className="h-full" />
        <div className="relative">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Try Beam
          </h2>
          <div className="n10-frame bg-fd-background mx-auto mt-6 flex max-w-md items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-4">
            <code className="flex-1 overflow-x-auto text-left font-mono text-sm whitespace-nowrap">
              <span className="text-fd-primary/70 select-none">$ </span>
              {INSTALL}
            </code>
            <CopyButton text={INSTALL} label="Copy the Beam install command" />
          </div>
          <p className="text-fd-muted-foreground mx-auto mt-5 max-w-md text-sm text-pretty">
            Beam is still early. If the docs and reality don&apos;t match,
            please open an issue.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/docs/beam" className={buttonVariants()}>
              Read the docs
            </Link>
            <Link
              href="https://github.com/notaharness/n10/issues"
              className={buttonVariants({ variant: 'outline' })}
            >
              Report an issue
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
