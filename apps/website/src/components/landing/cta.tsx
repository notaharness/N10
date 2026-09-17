import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function Cta() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="rounded-lg border border-fd-border bg-fd-card p-8">
        <p className="text-sm">
          n10 is still early in development. We use it every day, but expect
          rough edges and breaking changes.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/docs" className={buttonVariants()}>
            Read the docs
          </Link>
          <Link
            href="https://github.com/HermannBjorgvin/agent-plugins/tree/main/orchestra"
            className={buttonVariants({ variant: 'outline' })}
          >
            Pair with Orchestra
          </Link>
        </div>
      </div>
    </section>
  );
}
