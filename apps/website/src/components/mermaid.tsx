'use client';

import mermaid from 'mermaid';
import { useTheme } from 'next-themes';
import { useEffect, useId, useState } from 'react';

/**
 * Reads a Fumadocs `--color-fd-*` custom property's resolved value.
 *
 * Mermaid's theming can't take a `var(...)` reference directly: it
 * parses every themeVariables colour at `initialize()` time to compute
 * derived shades (borders, hover states, contrast text), which needs a
 * real colour string, not an unresolved CSS variable. Reading the
 * computed value here, after the `.dark` class has already been applied
 * (see the `resolvedTheme` dependency below), gets the real value for
 * whichever theme is active.
 */
function fdColor(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Renders a `<Mermaid chart="..." />` reference, produced from a
 * ```mermaid fence by remarkMdxMermaid (see source.config.ts). `mermaid`
 * only touches the DOM inside `render`, called from `useEffect`, so
 * importing it at module scope stays SSR-safe.
 *
 * `theme: 'base'` is required for `themeVariables` to fully apply —
 * 'default'/'dark' bring their own baked-in palette that these would
 * only partially override. `securityLevel: 'loose'` (mermaid's own
 * default for embedding docs content the site owner controls, rather
 * than user input) allows diagrams to use clickable nodes and HTML
 * labels.
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '-');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // next-themes reports `resolvedTheme` as undefined until it has read
    // localStorage/media query client-side; wait for that (and for the
    // `.dark` class it applies) rather than resolving colours too early.
    if (resolvedTheme === undefined) return;
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      flowchart: { htmlLabels: true },
      themeVariables: {
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        fontSize: '16px',
        background: fdColor('--color-fd-background'),
        mainBkg: fdColor('--color-fd-secondary'),
        primaryColor: fdColor('--color-fd-secondary'),
        primaryTextColor: fdColor('--color-fd-foreground'),
        primaryBorderColor: fdColor('--color-fd-border'),
        secondaryColor: fdColor('--color-fd-muted'),
        tertiaryColor: fdColor('--color-fd-card'),
        lineColor: fdColor('--color-fd-muted-foreground'),
        textColor: fdColor('--color-fd-foreground'),
        clusterBkg: fdColor('--color-fd-card'),
        clusterBorder: fdColor('--color-fd-border'),
        edgeLabelBackground: fdColor('--color-fd-background'),
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
  }, [chart, id, resolvedTheme]);

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
