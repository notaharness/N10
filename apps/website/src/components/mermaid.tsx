'use client';

import mermaid from 'mermaid';
import { useEffect, useId, useState } from 'react';

/**
 * Renders a `<Mermaid chart="..." />` reference, produced from a
 * ```mermaid fence by remarkMdxMermaid (see source.config.ts). `mermaid`
 * only touches the DOM inside `render`, called from `useEffect`, so
 * importing it at module scope stays SSR-safe.
 *
 * Colours are Fumadocs' own --color-fd-* CSS variables (see
 * src/app/global.css), not hardcoded hex: mermaid accepts a CSS
 * `var(...)` reference anywhere it accepts a colour string, so the
 * diagram follows the site's light/dark toggle live, with no need to
 * re-render on theme change. `theme: 'base'` is required for
 * `themeVariables` to fully apply — 'default'/'dark' bring their own
 * baked-in palette that these would only partially override.
 *
 * `securityLevel: 'loose'` (mermaid's own default for embedding docs
 * content the site owner controls, rather than user input) allows
 * diagrams to use clickable nodes and HTML labels.
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      flowchart: { htmlLabels: true },
      themeVariables: {
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        fontSize: '16px',
        background: 'var(--color-fd-background)',
        mainBkg: 'var(--color-fd-secondary)',
        primaryColor: 'var(--color-fd-secondary)',
        primaryTextColor: 'var(--color-fd-foreground)',
        primaryBorderColor: 'var(--color-fd-border)',
        secondaryColor: 'var(--color-fd-muted)',
        tertiaryColor: 'var(--color-fd-card)',
        lineColor: 'var(--color-fd-muted-foreground)',
        textColor: 'var(--color-fd-foreground)',
        clusterBkg: 'var(--color-fd-card)',
        clusterBorder: 'var(--color-fd-border)',
        edgeLabelBackground: 'var(--color-fd-background)',
      },
    });

    mermaid
      .render(id, chart)
      .then(({ svg: rendered }) => {
        if (cancelled) return;
        // Mermaid caps the SVG's width to the diagram's own natural size
        // via an inline `style="max-width: ...px"` on the root element;
        // strip it so the container's `w-full` can scale the diagram up
        // to fill the page instead of rendering it at native (tiny) size.
        setSvg(rendered.replace(/ style="max-width:[^"]*"/, ''));
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-fd-error/50 bg-fd-error/10 p-4 text-sm text-fd-error">
        Failed to render diagram: {error}
      </div>
    );
  }

  return (
    <div className="[&_svg]:h-auto [&_svg]:w-full my-4 overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-6">
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
