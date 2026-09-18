'use client';

import { useState, type CSSProperties } from 'react';
import { Logo, type LogoColors } from '@/components/logo';
import { buttonVariants } from '@/components/ui/button';

/**
 * Candidate pane pairs. Multiply blending only gives a clean third colour
 * when the two share a channel, so every pair here is two of the
 * subtractive primaries (cyan / magenta / yellow) or a near neighbour;
 * the mix column is the real product the browser will paint.
 */
const PALETTES: { name: string; note: string; colors: LogoColors }[] = [
  {
    name: 'Azure / Yellow',
    note: 'Current. Sky and sun; mixes to a leaf green.',
    colors: { n: '#2ba3ff', ten: '#ffd93d' },
  },
  {
    name: 'Cyan / Magenta',
    note: 'The print primaries; mixes to a deep indigo blue.',
    colors: { n: '#33d6ff', ten: '#ff5fb8' },
  },
  {
    name: 'Magenta / Yellow',
    note: 'Warm and loud; mixes to a red-orange.',
    colors: { n: '#ff5fb8', ten: '#ffd93d' },
  },
  {
    name: 'Violet / Pink',
    note: 'One family, two tints; mixes to a saturated purple.',
    colors: { n: '#7c6cff', ten: '#ff8fd8' },
  },
  {
    name: 'Brand blue / Amber',
    note: "The desktop's accent blue; darker, mixes to a forest green.",
    colors: { n: '#0078d4', ten: '#ffb830' },
  },
  {
    name: 'Red / Cyan',
    note: 'Anaglyph glasses. True complements, so the overlap goes to black — exactly what stacked 3D filters do.',
    colors: { n: '#ff2222', ten: '#18e0e0' },
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

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** The multiply product of two hex colours, as the browser will paint it. */
function multiply(a: string, b: string): string {
  const hex = [0, 1, 2]
    .map((i) => Math.round((channel(a, i) * channel(b, i)) / 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        className="inline-block size-3 rounded-sm border border-fd-border"
        style={{ background: color }}
      />
      {label} {color}
    </span>
  );
}

export function LogoLab() {
  // Bumping the key remounts every intro logo so the mix replays.
  const [run, setRun] = useState(0);

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
              The flag reaches left by the same 14 units the bar sits off the
              stave, so its tip lands on the stave&apos;s left edge.
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
