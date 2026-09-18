'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Logo, type LogoColors } from '@/components/logo';
import { buttonVariants } from '@/components/ui/button';
import { PALETTES, Swatch, multiply } from '@/components/logo-lab-shared';

/**
 * Live overlap slider plus colour pickers, with presets to load from.
 * Controlled from `LogoLab` so the same values can also drive the extra
 * row in the "Colour at nav size" section.
 */
export function LogoLabInteractive({
  overlap,
  setOverlap,
  colors,
  setColors,
}: {
  overlap: number;
  setOverlap: Dispatch<SetStateAction<number>>;
  colors: LogoColors;
  setColors: Dispatch<SetStateAction<LogoColors>>;
}) {
  const mix = multiply(colors.n, colors.ten);

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-fd-border p-5">
      <h2 className="text-lg font-medium">Interactive</h2>
      <p className="text-fd-muted-foreground -mt-4 text-sm">
        Drag the overlap, or pick your own pane colours — the extra row in
        &quot;Colour at nav size&quot; below tracks this.
      </p>
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
        <div className="flex flex-col items-start gap-4">
          <Logo
            colors={colors}
            overlap={overlap}
            hover
            className="h-20 w-auto"
          />
          <div className="flex items-center gap-3">
            <Logo
              colors={colors}
              overlap={overlap}
              hover
              className="h-6 w-auto"
            />
            <span className="text-fd-muted-foreground text-xs">nav size</span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm">
            <span className="flex justify-between">
              <span>Overlap</span>
              <span className="text-fd-muted-foreground font-mono">
                {Math.round(overlap * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(overlap * 100)}
              onChange={(e) => setOverlap(Number(e.target.value) / 100)}
              className="accent-fd-primary"
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span>N colour</span>
              <input
                type="color"
                value={colors.n}
                onChange={(e) =>
                  setColors((c) => ({ ...c, n: e.target.value }))
                }
                className="border-fd-border h-9 w-14 cursor-pointer rounded border bg-transparent p-1"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>10 colour</span>
              <input
                type="color"
                value={colors.ten}
                onChange={(e) =>
                  setColors((c) => ({ ...c, ten: e.target.value }))
                }
                className="border-fd-border h-9 w-14 cursor-pointer rounded border bg-transparent p-1"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Load preset</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const preset = PALETTES[Number(e.target.value)];
                  if (preset) setColors(preset.colors);
                }}
                className="border-fd-border bg-fd-background h-9 rounded border px-2 text-sm"
              >
                <option value="" disabled>
                  Choose…
                </option>
                {PALETTES.map((p, i) => (
                  <option key={p.name} value={i}>
                    {i + 1}. {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={buttonVariants({ variant: 'outline' })}
              onClick={() => setColors({ n: colors.ten, ten: colors.n })}
            >
              Swap
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Swatch color={colors.n} label="N" />
            <Swatch color={colors.ten} label="10" />
            <Swatch color={mix} label="mix" />
          </div>
        </div>
      </div>
    </section>
  );
}
