import Link from 'next/link';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { buttonVariants } from '@/components/ui/button';

export function Cta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24">
      <div className="border-fd-border bg-fd-card relative overflow-hidden rounded-2xl border px-6 py-16 text-center sm:py-20">
        <HeroBackdrop cells={false} className="h-full" />
        <div className="relative">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            n10 is still early
          </h2>
          <p className="text-fd-muted-foreground mx-auto mt-4 max-w-md text-pretty">
            I use it every day, but it still has rough edges and breaking
            changes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/docs" className={buttonVariants()}>
              Read the docs
            </Link>
            <Link
              href="https://github.com/notaharness/n10"
              className={buttonVariants({ variant: 'outline' })}
            >
              GitHub
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
