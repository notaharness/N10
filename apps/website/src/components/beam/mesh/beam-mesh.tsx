'use client';

import { Pause, Play } from 'lucide-react';
import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { lane, project, ribbon, type Vec2, type Vec3 } from './geometry';
import { Ground } from './ground';
import { Laptop, Mini, Pad, Rack, Tower } from './machines';
import { BEAM_COLORS } from './palette';

/**
 * Several paired machines on one ground plane, each pair joined by its
 * own beam with traffic running both ways. Drawn in a 30° isometric
 * projection (see geometry.ts); machines are listed back to front,
 * which is also the order they have to be painted in. The svg
 * overflows its box on purpose: ground.tsx draws the plane out across
 * the whole hero.
 */
const machines = [
  { id: 'rack', label: 'build box', cx: 3, cy: 3, Shape: Rack },
  { id: 'tower', label: 'workstation', cx: 10, cy: 3, Shape: Tower },
  { id: 'laptop', label: 'your laptop', cx: 3, cy: 10, Shape: Laptop },
  { id: 'mini', label: 'home server', cx: 10, cy: 10, Shape: Mini },
] as const;

/** Where each label hangs: the highest, rearmost point of its machine. */
const labelAnchors: Record<(typeof machines)[number]['id'], Vec3> = {
  rack: [1.7, 1.7, 2.5],
  tower: [9.25, 1.7, 3.14],
  laptop: [3, 8.65, 2.13],
  mini: [9.05, 9.05, 0.74],
};

interface Beam {
  id: string;
  color: string;
  /** Axis-aligned ground path between two machines' centres. */
  path: readonly Vec2[];
  /** Seconds for a packet to travel the whole beam. */
  seconds: number;
}

const beams: Beam[] = [
  {
    id: 'rack-tower',
    color: BEAM_COLORS.sand,
    path: [
      [3, 3],
      [10, 3],
    ],
    seconds: 3.2,
  },
  {
    id: 'rack-laptop',
    color: BEAM_COLORS.sage,
    path: [
      [3, 3],
      [3, 10],
    ],
    seconds: 2.6,
  },
  {
    id: 'laptop-mini',
    color: BEAM_COLORS.clay,
    path: [
      [3, 10],
      [10, 10],
    ],
    seconds: 3.8,
  },
  {
    id: 'tower-mini',
    color: BEAM_COLORS.blue,
    path: [
      [10, 3],
      [10, 10],
    ],
    seconds: 2.9,
  },
  {
    id: 'laptop-tower',
    color: BEAM_COLORS.mauve,
    path: [
      [3, 9],
      [6.5, 9],
      [6.5, 4],
      [10, 4],
    ],
    seconds: 4.4,
  },
];

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function BeamTrack({ beam }: { beam: Beam }) {
  const vars = {
    '--n10-mesh-color': beam.color,
    '--n10-mesh-seconds': `${beam.seconds}s`,
  } as CSSProperties;
  return (
    <g style={vars}>
      {ribbon(beam.path, 0.56).map((points) => (
        <polygon key={points} points={points} className="n10-mesh-ribbon" />
      ))}
      <polyline
        points={lane(beam.path, -0.11)}
        pathLength={100}
        className="n10-mesh-packet"
      />
      <polyline
        points={lane(beam.path, 0.11)}
        pathLength={100}
        className="n10-mesh-packet n10-mesh-packet--back"
      />
    </g>
  );
}

export function BeamMesh({ className }: { className?: string }) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
  // null follows the system setting; a click on the button overrides it.
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduced;
  const Icon = playing ? Pause : Play;

  return (
    <figure className={className}>
      <div className="relative">
        <svg
          viewBox="-285 -48 570 350"
          className="n10-mesh h-auto w-full overflow-visible"
          data-playing={choice === null ? undefined : String(choice)}
          role="img"
          aria-label="Four machines — a laptop, a workstation, a build box and a home server — each connected to the others by its own beam, with data moving along every beam in both directions."
        >
          <Ground />
          {beams.map((beam) => (
            <BeamTrack key={beam.id} beam={beam} />
          ))}
          {machines.map(({ id, label, cx, cy, Shape }) => {
            const [lx, ly] = project(labelAnchors[id]);
            return (
              <g key={id}>
                <Pad cx={cx} cy={cy} />
                <Shape cx={cx} cy={cy} />
                <text x={lx} y={ly - 9} className="n10-mesh-label">
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
        <button
          type="button"
          onClick={() => setChoice(!playing)}
          aria-label={playing ? 'Pause the animation' : 'Play the animation'}
          className="text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground focus-visible:ring-fd-ring absolute right-0 bottom-0 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </div>
    </figure>
  );
}
