'use client';

import { useState, type CSSProperties } from 'react';
import { Logo, type LogoColors, type LogoNShape } from '@/components/logo';
import { buttonVariants } from '@/components/ui/button';
import { LogoLabInteractive } from '@/components/logo-lab-interactive';
import { LogoLabTiled } from '@/components/logo-lab-tiled';
import { PALETTES, Swatch, multiply } from '@/components/logo-lab-shared';

const N_SHAPES: { shape: LogoNShape; name: string; note: string }[] = [
  {
    shape: 'lower',
    name: 'Lowercase, drawn on the module (current)',
    note: 'Built the way a type designer builds an n — notched where the shoulder leaves the stem, a thinner arch, a tight shoulder — with both stems still exactly one module wide.',
  },
  {
    shape: 'lowerGeist',
    name: 'Lowercase, Geist Black',
    note: 'The n from the site’s own typeface, untouched. The model for the one beside it; its stems are slightly wider than a module, so it sits near the grid rather than on it.',
  },
  {
    shape: 'upper',
    name: 'Capital (previous)',
    note: 'The capital N the mark used before: 3 × 4 modules, level with the 1 and the 0.',
  },
];

/** Timing variants, applied through the logo's CSS custom properties. */
const MOTIONS: { name: string; note: string; vars: Record<string, string> }[] =
  [
    {
      name: 'A — proposed',
      note: 'Hover 320ms ease-out (quint). Intro 900ms ease-in-out (quart) after 800ms.',
      vars: {},
    },
    {
      name: 'B — quicker',
      note: 'Hover 240ms ease-out (expo). Intro 800ms iOS drawer curve after 600ms.',
      vars: {
        '--n10-logo-hover-duration': '240ms',
        '--n10-logo-hover-ease': 'cubic-bezier(0.19, 1, 0.22, 1)',
        '--n10-logo-intro-duration': '800ms',
        '--n10-logo-intro-ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
        '--n10-logo-intro-delay': '600ms',
      },
    },
    {
      name: 'C — slower',
      note: 'Hover 420ms ease-in-out (cubic). Intro 1200ms ease-in-out (quint) after 1000ms.',
      vars: {
        '--n10-logo-hover-duration': '420ms',
        '--n10-logo-hover-ease': 'cubic-bezier(0.645, 0.045, 0.355, 1)',
        '--n10-logo-intro-duration': '1200ms',
        '--n10-logo-intro-ease': 'cubic-bezier(0.86, 0, 0.07, 1)',
        '--n10-logo-intro-delay': '1000ms',
      },
    },
  ];

/** Stave overlap fractions to compare, 100% down to the default 50%. */
const OVERLAPS = [1, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];

export function LogoLab() {
  // Bumping the key remounts every intro logo so the mix replays.
  const [run, setRun] = useState(0);
  const [overlap, setOverlap] = useState(0.5);
  const [colors, setColors] = useState<LogoColors>(PALETTES[0].colors);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Logo lab</h1>
          <p className="text-fd-muted-foreground mt-1 text-sm">
            Hover any mark to split it. Large marks play the intro on load.
            Toggle the theme in the nav to check both grounds.
          </p>
        </div>
        <button
          type="button"
          className={buttonVariants({ variant: 'outline' })}
          onClick={() => setRun((r) => r + 1)}
        >
          Replay intros
        </button>
      </header>

      <LogoLabInteractive
        overlap={overlap}
        setOverlap={setOverlap}
        colors={colors}
        setColors={setColors}
      />

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Tiled</h2>
        <p className="text-fd-muted-foreground -mt-4 text-sm">
          The mark repeated as a 45° wallpaper, driven by the Interactive panel
          above.
        </p>
        <LogoLabTiled colors={colors} overlap={overlap} />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Motion</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {MOTIONS.map((m) => (
            <div
              key={m.name}
              className="flex flex-col gap-4 rounded-lg border border-fd-border p-5"
              style={m.vars as CSSProperties}
            >
              <Logo key={run} intro hover className="h-16 w-auto" />
              <div className="flex items-center gap-3">
                <Logo hover className="h-6 w-auto" />
                <span className="text-fd-muted-foreground text-xs">
                  nav size
                </span>
              </div>
              <div>
                <div className="font-medium">{m.name}</div>
                <p className="text-fd-muted-foreground text-sm">{m.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Colour</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {PALETTES.map((p, i) => (
            <div
              key={p.name}
              className="flex flex-col gap-4 rounded-lg border border-fd-border p-5"
            >
              <Logo
                key={run}
                intro
                hover
                colors={p.colors}
                className="h-20 w-auto"
              />
              <div className="flex items-center gap-3">
                <Logo hover colors={p.colors} className="h-6 w-auto" />
                <span className="text-fd-muted-foreground text-xs">
                  nav size
                </span>
              </div>
              <div>
                <div className="font-medium">
                  {i + 1}. {p.name}
                </div>
                <p className="text-fd-muted-foreground text-sm">{p.note}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Swatch color={p.colors.n} label="N" />
                  <Swatch color={p.colors.ten} label="10" />
                  <Swatch
                    color={multiply(p.colors.n, p.colors.ten)}
                    label="mix"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Colour at nav size</h2>
        <p className="text-fd-muted-foreground -mt-4 text-sm">
          Every palette at the navbar&apos;s h-6, spaced like a row of browser
          tabs. Step back from the screen.
        </p>
        <div className="flex flex-wrap items-center gap-x-12 gap-y-8 py-6">
          {PALETTES.map((p, i) => (
            <div key={p.name} className="flex items-center gap-3">
              <span className="text-fd-muted-foreground w-4 text-right font-mono text-xs">
                {i + 1}
              </span>
              <Logo hover colors={p.colors} className="h-6 w-auto" />
            </div>
          ))}
        </div>
        <p className="text-fd-muted-foreground text-sm">
          Same pairs with the N and the 10 swapped.
        </p>
        <div className="flex flex-wrap items-center gap-x-12 gap-y-8 py-6">
          {PALETTES.map((p, i) => (
            <div key={p.name} className="flex items-center gap-3">
              <span className="text-fd-muted-foreground w-4 text-right font-mono text-xs">
                {i + 1}s
              </span>
              <Logo
                hover
                colors={{ n: p.colors.ten, ten: p.colors.n }}
                className="h-6 w-auto"
              />
            </div>
          ))}
        </div>
        <p className="text-fd-muted-foreground text-sm">
          Your own pick from the Interactive panel above, at the same size.
        </p>
        <div className="flex items-center gap-3 py-6">
          <span className="text-fd-muted-foreground w-4 text-right font-mono text-xs">
            ✎
          </span>
          <Logo
            hover
            colors={colors}
            overlap={overlap}
            className="h-6 w-auto"
          />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Lowercase n</h2>
        <p className="text-fd-muted-foreground -mt-4 text-sm">
          A lowercase n at a three-module x-height, with the 1 and the 0
          standing a module taller. Shown against the current capital; hover to
          split.
        </p>
        <div className="grid gap-6 sm:grid-cols-3">
          {N_SHAPES.map(({ shape, name, note }) => (
            <div
              key={shape}
              className="flex flex-col gap-4 rounded-lg border border-fd-border p-5"
            >
              <Logo
                key={run}
                intro
                hover
                nShape={shape}
                className="h-20 w-auto self-start"
              />
              <div className="flex items-center gap-3">
                <Logo hover nShape={shape} className="h-6 w-auto" />
                <span className="text-fd-muted-foreground text-xs">
                  nav size
                </span>
              </div>
              <div className="font-medium">{name}</div>
              <p className="text-fd-muted-foreground text-sm">{note}</p>
            </div>
          ))}
        </div>
        <p className="text-fd-muted-foreground text-sm">
          On the hero&apos;s grid, one stroke to a cell. Hover to split.
        </p>
        <div className="overflow-x-auto rounded-lg border border-fd-border">
          <div className="n10-lab-grid">
            {N_SHAPES.map(({ shape }, i) => (
              <Logo
                key={shape}
                hover
                nShape={shape}
                className="n10-logo--grid absolute"
                style={{
                  left: `calc(var(--n10-cell) * ${1 + i * 10})`,
                  top: 'var(--n10-cell)',
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Flagged 1 at 50%</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col gap-4 rounded-lg border border-fd-border p-5">
            <Logo key={run} intro hover flag className="h-20 w-auto" />
            <div className="flex items-center gap-3">
              <Logo hover flag className="h-6 w-auto" />
              <span className="text-fd-muted-foreground text-xs">nav size</span>
            </div>
            <p className="text-fd-muted-foreground text-sm">
              A 45° slab, one stroke deep, reaching left by the same half stroke
              the bar sits off the stave so its flat end sits flush on the
              stave&apos;s edge.
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Overlap</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {OVERLAPS.map((o) => (
            <div
              key={o}
              className="flex flex-col gap-4 rounded-lg border border-fd-border p-5"
            >
              <Logo key={run} intro hover overlap={o} className="h-20 w-auto" />
              <div className="flex items-center gap-3">
                <Logo hover overlap={o} className="h-6 w-auto" />
                <span className="text-fd-muted-foreground text-xs">
                  nav size
                </span>
              </div>
              <div className="font-medium">{Math.round(o * 100)}%</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
