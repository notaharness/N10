import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoVideo } from '@/components/demo-video';
import { cn } from '@/lib/cn';

export interface Feature {
  media: string;
  /** Short name shown beside the index, e.g. "Worktrees". */
  label: string;
  title: string;
  description: ReactNode;
  /** Alt text for the demo; defaults to the title. */
  alt?: string;
  /** Docs page that covers this feature in full. */
  href: string;
}

/**
 * Copy on one side, a framed demo on the other, with a tinted pane
 * peeking out from behind the frame on the outer corner — sage and
 * sand alternate down the page along with the sides.
 */
export function FeatureSection({
  media,
  label,
  title,
  description,
  alt,
  href,
  reverse = false,
}: Feature & { reverse?: boolean }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-12 md:gap-14">
      <div className={cn('min-w-0 md:col-span-5', reverse && 'md:order-2')}>
        <p className="text-fd-primary font-mono text-xs tracking-wide">
          {label}
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h2>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
          {description}
        </p>
        <Link
          href={href}
          className="text-fd-primary group mt-5 inline-flex items-center gap-1 text-sm font-medium"
        >
          Read the guide
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>
      <div className="relative min-w-0 md:col-span-7">
        <div
          aria-hidden
          className={cn(
            'n10-pane absolute top-6 -bottom-3 rounded-xl',
            reverse
              ? 'n10-pane--sand right-6 -left-3'
              : 'n10-pane--sage -right-3 left-6'
          )}
        />
        <DemoVideo
          name={media}
          alt={alt ?? title}
          className="n10-frame relative w-full rounded-xl"
        />
      </div>
    </div>
  );
}
