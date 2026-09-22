import type { CSSProperties } from 'react';
import {
  inQuad,
  project,
  toPoints,
  type Vec2,
} from '@/components/beam/mesh/geometry';
import { panel, turnedBox } from '@/components/orchestra/stage-geometry';
import { Nameplate } from '@/components/orchestra/stage-figures';
import { Faces, place } from '@/components/orchestra/stage-parts';
import {
  KIND_COLOR,
  type Kind,
  type PlayerSpec,
  type Status,
} from '@/components/orchestra/stage-script';

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
 * A player: a chunky computer with a tilted screen, humming along at
 * its stand and now and then shaking itself in a burst of effort. A
 * badge above the screen says when it has something to report.
 */
export function PlayerBox({
  spec,
  status,
  index,
}: {
  spec: PlayerSpec;
  status: Status;
  index: number;
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
  const top = project(inQuad(lid, 0.5, 1));
  const fwd: Vec2 = [-Math.sin(at.heading), Math.cos(at.heading)];
  const plate: Vec2 = [at.cx + fwd[0] * 1.3, at.cy + fwd[1] * 1.3];
  const vars = {
    '--orchestra-kind': KIND_COLOR[STATUS_KIND[status]],
    '--orchestra-stagger': `${index * -1.7}s`,
  } as CSSProperties;
  return (
    <g className="orchestra-player" data-status={status} style={vars}>
      <g className="orchestra-shake">
        <g className="orchestra-hum">
          <Faces faces={turnedBox(at, 1.45, 0.85, 1.05)} />
          <polygon
            points={toPoints(panel(at, 0.9, -0.43, 0.2, 0.05, 0))}
            className="orchestra-vent"
          />
          <polygon
            points={toPoints(panel(at, 0.9, -0.43, 0.32, 0.05, 0))}
            className="orchestra-vent"
          />
          <polygon
            points={toPoints(panel(at, 0.14, -0.43, 0.7, 0.12, 0))}
            className="orchestra-led"
          />
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
        </g>
      </g>
      {status !== 'working' && (
        <g
          className="orchestra-badge"
          style={{ color: KIND_COLOR[STATUS_KIND[status]] }}
        >
          <rect x={top[0] - 9} y={top[1] - 24} width="18" height="15" rx="4" />
          <text x={top[0]} y={top[1] - 13}>
            {STATUS_GLYPH[status]}
          </text>
        </g>
      )}
      <Nameplate ground={plate} branch={spec.branch} agent={spec.agent} />
    </g>
  );
}
