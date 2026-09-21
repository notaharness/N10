import type { CSSProperties } from 'react';
import {
  centreLine,
  project,
  ribbon,
  toPoints,
  TRACK_WIDTH,
  type Vec2,
} from './geometry';
import { BEAM_COLORS } from './palette';

/**
 * Everything under the machines, drawn well past the figure's own box.
 * The svg lets it overflow, so the isometric ground becomes the whole
 * hero's backdrop — one grid, the scene's own — and the four straight
 * beams carry on beyond their machines as rays that fade toward the
 * edges of the page, toward machines that aren't in the picture.
 */
const REACH = 32;
const CENTRE = 6.5;
const RAY_LENGTH = 30;

const gridLines = Array.from({ length: REACH * 2 + 1 }, (_, n) => {
  const i = CENTRE - REACH + n;
  return [
    toPoints([
      [i, CENTRE - REACH, 0],
      [i, CENTRE + REACH, 0],
    ]),
    toPoints([
      [CENTRE - REACH, i, 0],
      [CENTRE + REACH, i, 0],
    ]),
  ];
}).flat();

interface Ray {
  id: string;
  color: string;
  from: Vec2;
  /** Unit step along a ground axis. */
  dir: Vec2;
  seconds: number;
  /** Packets travel toward the machine instead of away from it. */
  inbound?: boolean;
}

const rays: Ray[] = [
  {
    id: 'sand-a',
    color: BEAM_COLORS.sand,
    from: [3, 3],
    dir: [-1, 0],
    seconds: 11,
    inbound: true,
  },
  {
    id: 'sand-b',
    color: BEAM_COLORS.sand,
    from: [10, 3],
    dir: [1, 0],
    seconds: 9,
  },
  {
    id: 'sage-a',
    color: BEAM_COLORS.sage,
    from: [3, 3],
    dir: [0, -1],
    seconds: 12,
  },
  {
    id: 'sage-b',
    color: BEAM_COLORS.sage,
    from: [3, 10],
    dir: [0, 1],
    seconds: 10,
    inbound: true,
  },
  {
    id: 'blue-a',
    color: BEAM_COLORS.blue,
    from: [10, 3],
    dir: [0, -1],
    seconds: 13,
    inbound: true,
  },
  {
    id: 'blue-b',
    color: BEAM_COLORS.blue,
    from: [10, 10],
    dir: [0, 1],
    seconds: 9.5,
  },
  {
    id: 'clay-a',
    color: BEAM_COLORS.clay,
    from: [3, 10.5],
    dir: [-1, 0],
    seconds: 10.5,
  },
  {
    id: 'clay-b',
    color: BEAM_COLORS.clay,
    from: [10, 10.5],
    dir: [1, 0],
    seconds: 12.5,
    inbound: true,
  },
];

function RayTrack({ ray }: { ray: Ray }) {
  const to: Vec2 = [
    ray.from[0] + ray.dir[0] * RAY_LENGTH,
    ray.from[1] + ray.dir[1] * RAY_LENGTH,
  ];
  const [x1, y1] = project([...ray.from, 0]);
  const [x2, y2] = project([...to, 0]);
  const fade = `n10-mesh-ray-${ray.id}`;
  const vars = { '--n10-mesh-seconds': `${ray.seconds}s` } as CSSProperties;
  return (
    <g style={vars}>
      <linearGradient
        id={fade}
        gradientUnits="userSpaceOnUse"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
      >
        <stop offset="0" stopColor={ray.color} stopOpacity="1" />
        <stop offset="0.3" stopColor={ray.color} stopOpacity="0.4" />
        <stop offset="1" stopColor={ray.color} stopOpacity="0" />
      </linearGradient>
      {ribbon([ray.from, to], TRACK_WIDTH).map((points) => (
        <polygon
          key={points}
          points={points}
          fill={`url(#${fade})`}
          className="n10-mesh-ray"
        />
      ))}
      <polyline
        points={centreLine([ray.from, to])}
        pathLength={100}
        stroke={`url(#${fade})`}
        className={
          ray.inbound
            ? 'n10-mesh-ray-packet n10-mesh-ray-packet--inbound'
            : 'n10-mesh-ray-packet'
        }
      />
    </g>
  );
}

export function Ground() {
  const [cx, cy] = project([CENTRE, CENTRE, 0]);
  return (
    <g>
      <defs>
        {/* Wider than tall, so the grid has faded out before the hero's
            bottom edge would cut it off. */}
        <radialGradient
          id="n10-mesh-fade"
          gradientUnits="userSpaceOnUse"
          cx={cx}
          cy={cy}
          r="1"
          gradientTransform={`translate(${cx} ${cy}) scale(760 330) translate(${-cx} ${-cy})`}
        >
          <stop offset="0" stopColor="white" />
          <stop offset="0.35" stopColor="white" stopOpacity="0.8" />
          <stop offset="0.85" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask
          id="n10-mesh-mask"
          maskUnits="userSpaceOnUse"
          x={cx - 800}
          y={cy - 400}
          width="1600"
          height="800"
        >
          <rect
            x={cx - 800}
            y={cy - 400}
            width="1600"
            height="800"
            fill="url(#n10-mesh-fade)"
          />
        </mask>
        <radialGradient id="n10-mesh-pool">
          <stop offset="0" stopColor="var(--n10-sand)" stopOpacity="0.5" />
          <stop offset="0.55" stopColor="var(--n10-sage)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--n10-sage)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx={cx}
        cy={cy}
        rx="430"
        ry="250"
        fill="url(#n10-mesh-pool)"
        className="n10-mesh-pool"
      />
      <g mask="url(#n10-mesh-mask)" className="n10-mesh-grid">
        {gridLines.map((points) => (
          <polyline key={points} points={points} />
        ))}
      </g>
      {rays.map((ray) => (
        <RayTrack key={ray.id} ray={ray} />
      ))}
    </g>
  );
}
