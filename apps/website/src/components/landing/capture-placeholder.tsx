import type { ReactNode } from 'react';

/**
 * Stands in for a recording that doesn't exist yet. It says so in
 * plain text, so nobody mistakes it for the product.
 */
export function CapturePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="border-fd-border bg-fd-card text-fd-muted-foreground flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 text-center text-sm">
      <span className="font-mono text-xs tracking-wide uppercase">
        Placeholder
      </span>
      <span className="max-w-sm text-pretty">{children}</span>
    </div>
  );
}
