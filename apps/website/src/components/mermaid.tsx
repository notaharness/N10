'use client';

import mermaid from 'mermaid';
import { useTheme } from 'next-themes';
import { useEffect, useId, useState } from 'react';

/**
 * Renders a `<Mermaid chart="..." />` reference, produced from a
 * ```mermaid fence by remarkMdxMermaid (see source.config.ts). `mermaid`
 * only touches the DOM inside `initialize`/`render`, both called from
 * `useEffect`, so importing it at module scope stays SSR-safe.
 *
 * `securityLevel: 'loose'` (mermaid's own default for embedding docs
 * content the site owner controls, rather than user input) allows
 * diagrams to use clickable nodes and HTML labels.
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '-');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // next-themes reports `resolvedTheme` as undefined until it has read
    // localStorage/media query client-side; wait for that rather than
    // rendering once with the wrong theme and again with the right one.
    if (resolvedTheme === undefined) return;
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: resolvedTheme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    });

    mermaid
      .render(id, chart)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-fd-destructive/50 bg-fd-destructive/10 p-4 text-sm text-fd-destructive">
        Failed to render diagram: {error}
      </div>
    );
  }

  return (
    <div className="my-4 flex justify-center overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4">
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className="text-fd-muted-foreground text-sm">
          Rendering diagram…
        </span>
      )}
    </div>
  );
}
