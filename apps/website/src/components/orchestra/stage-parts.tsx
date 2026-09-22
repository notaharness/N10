import type { CSSProperties } from 'react';
import {
  boxFaces,
  centreLine,
  project,
  ribbon,
  toPoints,
  TRACK_WIDTH,
  type Box,
  type Face,
  type Vec2,
} from '@/components/beam/mesh/geometry';
import { BEAM_COLORS } from '@/components/beam/mesh/palette';
import {
  groundArc,
  panel,
  turnedBox,
  type Placed,
} from '@/components/orchestra/stage-geometry';
import type { PlayerSpec } from '@/components/orchestra/stage-script';
import { Figure } from '@/components/orchestra/stage-figures';
import type { Flight } from '@/components/orchestra/use-show';

/** The pieces of the stage: see orchestra-stage.tsx for the scene. */
export const PODIUM: Vec2 = [8, 8];
export const TIER_R = 6.3;
/** The arc opens toward the viewer, who sits toward +x +y — turned a
 * little off the diagonal so no box is seen exactly square-on. */
export const FACING = (38 * Math.PI) / 180;

export function place(angle: number): Placed {
  const a = FACING + (angle * Math.PI) / 180;
  return {
    cx: PODIUM[0] + Math.cos(a) * TIER_R,
    cy: PODIUM[1] + Math.sin(a) * TIER_R,
    heading: a - Math.PI / 2,
  };
}

export function Faces({
  faces,
  className,
}: {
  faces: Face[];
  className?: string;
}) {
  return (
    <g className={className}>
      {faces.map((face) => (
        <polygon
          key={face.points}
          points={face.points}
          className={`n10-iso-face n10-iso-face--${face.tone}`}
        />
      ))}
    </g>
  );
}

function arcPoints(r: number, from: number, to: number): string {
  return groundArc(PODIUM, r, from, to)
    .map((p) => p.join(','))
    .join(' ');
}

export function Riser() {
  const from = FACING - (80 * Math.PI) / 180;
  const to = FACING + (80 * Math.PI) / 180;
  const inner = TIER_R - 1;
  const outer = TIER_R + 1;
  return (
    <g>
      <polygon
        points={`${arcPoints(outer, from, to)} ${arcPoints(inner, to, from)}`}
        className="orchestra-riser"
      />
      <polyline
        points={arcPoints(outer, from, to)}
        className="orchestra-riser-edge"
      />
      <polyline
        points={arcPoints(inner, from, to)}
        className="orchestra-riser-edge"
      />
    </g>
  );
}

export function Podium() {
  const [cx, cy] = PODIUM;
  const platform: Box = {
    x: cx - 1.4,
    y: cy - 1.4,
    z: 0,
    w: 2.8,
    d: 2.8,
    h: 0.35,
  };
  // The conductor stands at the back of the platform facing the
  // players (and so the viewer); the desk is between them.
  const back = FACING + Math.PI;
  const stand: Vec2 = [cx + Math.cos(back) * 0.55, cy + Math.sin(back) * 0.55];
  const desk: Placed = {
    cx: cx + Math.cos(FACING) * 0.35,
    cy: cy + Math.sin(FACING) * 0.35,
    heading: FACING + Math.PI / 2,
  };
  const [gx, gy] = project([cx, cy, 0.36]);
  return (
    <g>
      <Faces faces={boxFaces(platform)} className="orchestra-platform" />
      <ellipse cx={gx} cy={gy} rx="10" ry="5" className="orchestra-beat" />
      <ellipse
        cx={gx}
        cy={gy}
        rx="10"
        ry="5"
        className="orchestra-beat orchestra-beat--late"
      />
      <Figure
        ground={[stand[0], stand[1]]}
        color="var(--color-fd-foreground)"
        playing
        conductor
      />
      <Faces faces={turnedBox(desk, 1.3, 0.9, 0.12, 0.35)} />
      <polygon
        points={toPoints(panel(desk, 1.15, 0.05, 0.47, 0.02, 0.5))}
        className="orchestra-keys"
      />
      {/* The lid stands on the edge nearest the viewer and leans out,
          so the screen faces the conductor and we see its back. */}
      <polygon
        points={toPoints(panel(desk, 1.3, -0.45, 0.47, 0.72, -0.24))}
        className="n10-iso-face n10-iso-face--right"
      />
    </g>
  );
}

export function RemotePlatform({ spec }: { spec: PlayerSpec }) {
  const at = place(spec.angle);
  const platform: Box = {
    x: at.cx - 1.5,
    y: at.cy - 1.5,
    z: -0.001,
    w: 3,
    d: 3,
    h: 0.22,
  };
  // Straight along +y (down-left on screen), which is what the ribbon
  // helper can draw and roughly where the remote stand faces away from.
  const from: Vec2 = [at.cx, at.cy + 1.5];
  const to: Vec2 = [at.cx, at.cy + 15];
  const [x1, y1] = project([...from, 0]);
  const [x2, y2] = project([...to, 0]);
  const vars = {
    '--n10-mesh-color': BEAM_COLORS.mauve,
    '--n10-mesh-seconds': '7s',
  } as CSSProperties;
  return (
    <g style={vars}>
      <linearGradient
        id="orchestra-beam-fade"
        gradientUnits="userSpaceOnUse"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
      >
        <stop offset="0" stopColor={BEAM_COLORS.mauve} stopOpacity="1" />
        <stop offset="1" stopColor={BEAM_COLORS.mauve} stopOpacity="0" />
      </linearGradient>
      {ribbon([from, to], TRACK_WIDTH).map((points) => (
        <polygon
          key={points}
          points={points}
          fill="url(#orchestra-beam-fade)"
          className="n10-mesh-ray"
        />
      ))}
      <polyline
        points={centreLine([from, to])}
        pathLength={100}
        stroke="url(#orchestra-beam-fade)"
        className="n10-mesh-ray-packet n10-mesh-ray-packet--inbound"
      />
      <Faces faces={boxFaces(platform)} className="orchestra-remote-platform" />
    </g>
  );
}

export function Note({
  flight,
  onLanded,
}: {
  flight: Flight;
  onLanded: (key: number) => void;
}) {
  const vars = {
    '--fx': `${flight.from[0]}px`,
    '--fy': `${flight.from[1]}px`,
    '--tx': `${flight.to[0]}px`,
    '--ty': `${flight.to[1]}px`,
    color: flight.color,
  } as CSSProperties;
  return (
    <text
      className="orchestra-note"
      style={vars}
      onAnimationEnd={() => onLanded(flight.key)}
    >
      {flight.glyph}
    </text>
  );
}
