import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function BeamCta() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="border-fd-border bg-fd-card rounded-lg border p-8">
        <p className="text-sm font-semibold">Try Beam</p>
        <pre className="border-fd-border bg-fd-background mt-3 overflow-x-auto rounded-md border p-3 text-left font-mono text-sm">
          npm install -g @notaharness/beam
        </pre>
        <p className="text-fd-muted-foreground mt-4 text-sm">
          Beam is still early. If the docs and reality don&apos;t match, please
          open an issue.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
    </section>
  );
}
