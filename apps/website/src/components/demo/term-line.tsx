import type { ReactNode } from 'react';
import { spansOf, type Line, type Span } from '@/components/demo/term';

function classOf(tone: Span[1]): string | undefined {
  return tone
    ?.split(' ')
    .map((t) => `n10-t-${t}`)
    .join(' ');
}

/**
 * Spans in a pre-wrapped run. Each is keyed by where it starts in the
 * text, which is stable because script text never changes in place.
 * Empty spans draw nothing and would share a start, so they are dropped.
 */
export function Spans({ spans }: { spans: readonly Span[] }) {
  let end = 0;
  const placed = spans.map(([text, tone]) => {
    const start = end;
    end += text.length;
    return { start, text, tone };
  });
  return placed
    .filter(({ text }) => text !== '')
    .map(({ start, text, tone }) => (
      <span key={start} className={classOf(tone)}>
        {text}
      </span>
    ));
}

/** Terminal rows, as one pre-wrapped run joined by newlines. */
export function Lines({ lines }: { lines: readonly Line[] }) {
  const spans = lines.flatMap((line, i) => [
    ...(i > 0 ? ([['\n']] as const) : []),
    ...spansOf(line),
  ]);
  return (
    <div className="whitespace-pre-wrap">
      <Spans spans={spans} />
    </div>
  );
}

/**
 * A row with a fixed-width lead-in, like Claude Code's `  ⎿  ` or a
 * diff's line number, whose wrapped text stays indented past it.
 */
export function Hanging({
  lead,
  children,
  className,
}: {
  lead: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-[auto_1fr] ${className ?? ''}`}>
      <span className="whitespace-pre">{lead}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
