import type { CSSProperties } from 'react';
import {
  boxFaces,
  centreLine,
  inQuad,
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
import {
  KIND_COLOR,
  type Kind,
  type PlayerSpec,
  type Status,
} from '@/components/orchestra/stage-script';
import {
  AGENT_COLOR,
  Figure,
  Nameplate,
} from '@/components/orchestra/stage-figures';
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
    cx: cx + Math.cos(FACING) * 0.55,
    cy: cy + Math.sin(FACING) * 0.55,
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
      <Faces faces={turnedBox(desk, 1.1, 0.5, 0.95, 0.35)} />
      <polygon
        points={toPoints(panel(desk, 1.0, 0.2, 1.3, 0.05, 0.02))}
        className="orchestra-podium-top"
      />
    </g>
  );
}

const STATUS_GLYPH: Record<Status, string> = {
  working: '',
  question: '?',
  blocked: '!',
  done: '✓',
};

const STATUS_KIND: Record<Status, Kind> = {
  working: 'PROGRESS',
  question: 'QUESTION',
  blocked: 'BLOCKED',
  done: 'DONE',
};

export function Lectern({
  spec,
  status,
}: {
  spec: PlayerSpec;
  status: Status;
}) {
  const at = place(spec.angle);
  const lid = panel(at, 1.25, 0.32, 1.05, 0.85, 0.28);
  const screen = [
    inQuad(lid, 0.06, 0.08),
    inQuad(lid, 0.94, 0.08),
    inQuad(lid, 0.94, 0.92),
    inQuad(lid, 0.06, 0.92),
  ];
  const bars = [0.2, 0.35, 0.5, 0.65, 0.8];
  const centre = project(inQuad(lid, 0.5, 0.5));
  // The player stands on the viewer's side of the stand, a little to
  // its right so the screen stays in view past their shoulder.
  const fwd: Vec2 = [-Math.sin(at.heading), Math.cos(at.heading)];
  const side: Vec2 = [Math.cos(at.heading), Math.sin(at.heading)];
  const standing: Vec2 = [
    at.cx + fwd[0] * 1.0 + side[0] * 0.55,
    at.cy + fwd[1] * 1.0 + side[1] * 0.55,
  ];
  const plate: Vec2 = [at.cx + fwd[0] * 1.6, at.cy + fwd[1] * 1.6];
  const badge =
    status === 'working'
      ? null
      : { glyph: STATUS_GLYPH[status], color: KIND_COLOR[STATUS_KIND[status]] };
  const vars = {
    '--orchestra-kind': KIND_COLOR[STATUS_KIND[status]],
  } as CSSProperties;
  return (
    <g className="orchestra-lectern" data-status={status} style={vars}>
      <Faces faces={turnedBox(at, 1.45, 0.85, 1.05)} />
      <polygon
        points={toPoints(lid)}
        className="n10-iso-face n10-iso-face--left"
      />
      <polygon points={toPoints(screen)} className="orchestra-screen" />
      {status === 'working' &&
        bars.map((u, i) => (
          <polyline
            key={u}
            points={toPoints([inQuad(lid, u, 0.82), inQuad(lid, u, 0.18)])}
            pathLength={1}
            className="orchestra-bar"
            style={{ animationDelay: `${i * -0.23}s` }}
          />
        ))}
      {status !== 'working' && (
        <text x={centre[0]} y={centre[1] + 4} className="orchestra-glyph">
          {STATUS_GLYPH[status]}
        </text>
      )}
      <Figure
        ground={standing}
        color={AGENT_COLOR[spec.agent] ?? BEAM_COLORS.sage}
        playing={status === 'working'}
        badge={badge}
      />
      <Nameplate ground={plate} branch={spec.branch} agent={spec.agent} />
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
