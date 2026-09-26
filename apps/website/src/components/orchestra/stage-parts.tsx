import type { CSSProperties } from 'react';
import { project, toPoints, type Vec2 } from '@/components/beam/mesh/geometry';
import { Laptop, Mini, Rack, Tower } from '@/components/beam/mesh/machines';
import {
  KIND_COLOR,
  type Kind,
  type Machine,
  type PlayerSpec,
  type Status,
} from '@/components/orchestra/stage-script';
import type { Bubble, Flight } from '@/components/orchestra/use-show';

/**
 * The pieces of the stage, in the beam page's isometric language and
 * built from its machines. See orchestra-stage.tsx for the scene.
 */
export const PODIUM: Vec2 = [9, 2];

/**
 * The machines sit on an arc below the laptop *on screen*: the arc is
 * laid out in projected pixels and mapped back to the ground, so it
 * reads as a semicircle from where the viewer sits.
 */
const ARC_RX = 300;
const ARC_RY = 205;
const COS30 = Math.cos(Math.PI / 6);

const laptopScreen = project([...PODIUM, 0]);

/** The ground point under a screen-space position (the inverse of project at z = 0). */
function groundAt(sx: number, sy: number): Vec2 {
  const u = sx / (COS30 * 24);
  const v = sy / 12;
  return [(u + v) / 2, (v - u) / 2];
}

export function groundOf(spec: PlayerSpec): Vec2 {
  const a = (spec.angle * Math.PI) / 180;
  return groundAt(
    laptopScreen[0] + Math.cos(a) * ARC_RX,
    laptopScreen[1] + Math.sin(a) * ARC_RY
  );
}

/** The scene's box in screen space: the laptop near the top, the arc below. */
export const VIEW = {
  x: laptopScreen[0] - 360,
  y: laptopScreen[1] - 112,
  w: 720,
  h: 380,
};

const SHAPES: Record<
  Machine,
  (p: { cx: number; cy: number }) => React.JSX.Element
> = {
  tower: Tower,
  mini: Mini,
  rack: Rack,
  laptop: Laptop,
};

/** Height of each machine's highest point, for badges and notes. */
const TOPS: Record<Machine, number> = {
  tower: 3.0,
  mini: 0.6,
  rack: 2.36,
  laptop: 2.0,
};

export function machineTop(spec: PlayerSpec): Vec2 {
  const [x, y] = groundOf(spec);
  return project([x, y, TOPS[spec.machine]]);
}

export const podiumTop = project([PODIUM[0], PODIUM[1], 2.1]);

/** Where the fade is centred: the middle of the scene, between the laptop and the arc. */
const FOCUS: Vec2 = [laptopScreen[0], laptopScreen[1] + 84];
const REACH = 30;
const [gx, gy] = groundAt(...FOCUS).map(Math.round) as [number, number];
const gridLines = Array.from({ length: REACH * 2 + 1 }, (_, n) => {
  const i = n - REACH;
  return [
    toPoints([
      [gx + i, gy - REACH, 0],
      [gx + i, gy + REACH, 0],
    ]),
    toPoints([
      [gx - REACH, gy + i, 0],
      [gx + REACH, gy + i, 0],
    ]),
  ];
}).flat();

export function Ground() {
  const [cx, cy] = FOCUS;
  return (
    <g>
      <defs>
        <radialGradient
          id="orchestra-fade"
          gradientUnits="userSpaceOnUse"
          cx={cx}
          cy={cy}
          r="1"
          gradientTransform={`translate(${cx} ${cy}) scale(335 172) translate(${-cx} ${-cy})`}
        >
          <stop offset="0.35" stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="orchestra-mask">
          <rect
            x={VIEW.x}
            y={VIEW.y}
            width={VIEW.w}
            height={VIEW.h}
            fill="url(#orchestra-fade)"
          />
        </mask>
        <radialGradient id="orchestra-pool">
          <stop offset="0" stopColor="var(--n10-sand)" stopOpacity="0.45" />
          <stop offset="0.6" stopColor="var(--n10-sage)" stopOpacity="0.12" />
          <stop offset="1" stopColor="var(--n10-sage)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx={cx}
        cy={cy + 10}
        rx="300"
        ry="140"
        fill="url(#orchestra-pool)"
        className="orchestra-pool"
      />
      <g mask="url(#orchestra-mask)" className="n10-mesh-grid">
        {gridLines.map((points) => (
          <polyline key={points} points={points} />
        ))}
      </g>
    </g>
  );
}

const LANE = 3.5;

/** A player's beam: a straight line between the two machines' centres, one lane out and one back, its ends hidden under the machines so it seems to come from beneath them. */
export function Beam({ spec, seconds }: { spec: PlayerSpec; seconds: number }) {
  const vars = {
    '--n10-mesh-color': spec.color,
    '--n10-mesh-seconds': `${seconds}s`,
  } as CSSProperties;
  const [x1, y1] = project([...PODIUM, 0]);
  const [x2, y2] = project([...groundOf(spec), 0]);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * LANE;
  const ny = ((x2 - x1) / len) * LANE;
  return (
    <g style={vars}>
      {[-1, 1].map((side) => {
        const points = `${x1 + nx * side},${y1 + ny * side} ${x2 + nx * side},${
          y2 + ny * side
        }`;
        return (
          <g key={side}>
            <polyline points={points} className="orchestra-line" />
            <polyline
              points={points}
              pathLength={100}
              className={
                side < 0
                  ? 'n10-mesh-packet n10-mesh-packet--back'
                  : 'n10-mesh-packet'
              }
            />
          </g>
        );
      })}
    </g>
  );
}

/** The orchestrator: a laptop, top and centre. */
export function Podium() {
  return <Laptop cx={PODIUM[0]} cy={PODIUM[1]} />;
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

/**
 * A player: one of the beam page's machines, sitting still and working,
 * with a comic twitch now and then and a proper shake whenever an
 * instruction lands on it. Its lights take the colour of the report it
 * is about to send; a badge above says when it has one, and a bubble
 * above that shows the last thing said to it or by it.
 */
export function Player({
  spec,
  status,
  index,
  hits,
  bubble,
}: {
  spec: PlayerSpec;
  status: Status;
  index: number;
  /** How many instructions have landed on it; each one shakes it. */
  hits: number;
  bubble?: Bubble;
}) {
  const Shape = SHAPES[spec.machine];
  const [gx, gy] = groundOf(spec);
  const [tx, ty] = machineTop(spec);
  const [nx, ny] = project([gx, gy + 1.5, 0]);
  const vars = {
    '--orchestra-kind': KIND_COLOR[STATUS_KIND[status]],
    '--orchestra-stagger': `${index * -1.7}s`,
  } as CSSProperties;
  return (
    <g className="orchestra-player" data-status={status} style={vars}>
      <g
        key={hits}
        className={
          hits > 0 ? 'orchestra-shake orchestra-shake--hit' : 'orchestra-shake'
        }
      >
        <Shape cx={gx} cy={gy} />
      </g>
      {bubble && (
        <foreignObject
          key={bubble.key}
          x={Math.min(Math.max(tx - 84, VIEW.x + 6), VIEW.x + VIEW.w - 174)}
          y={ty - 96}
          width="168"
          height="64"
          className="orchestra-bubble"
          style={{ color: bubble.color }}
        >
          <div className="orchestra-bubble-box">
            <p className="orchestra-bubble-card">
              <b>{bubble.head}</b> {bubble.text}
            </p>
          </div>
        </foreignObject>
      )}
      {status !== 'working' && (
        <g
          className="orchestra-badge"
          style={{ color: KIND_COLOR[STATUS_KIND[status]] }}
        >
          <rect x={tx - 9} y={ty - 26} width="18" height="15" rx="4" />
          <text x={tx} y={ty - 15}>
            {STATUS_GLYPH[status]}
          </text>
        </g>
      )}
      <g className="orchestra-nameplate">
        <text x={nx} y={ny + 10}>
          {spec.branch}
        </text>
        <text x={nx} y={ny + 20} className="orchestra-nameplate-agent">
          {spec.agent}
        </text>
      </g>
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
