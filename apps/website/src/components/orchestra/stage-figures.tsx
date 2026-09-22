import type { CSSProperties } from 'react';
import { project, type Vec2 } from '@/components/beam/mesh/geometry';
import { BEAM_COLORS } from '@/components/beam/mesh/palette';

/**
 * The people on the stage, drawn as simple rounded figures seen from
 * behind and slightly above: a capsule body, a round head, two arms.
 * They stand at a ground point and are scaled to the scene's boxes.
 * Players are coloured by the agent they run; the conductor wears the
 * page's foreground colour.
 */
export const AGENT_COLOR: Record<string, string> = {
  claude: BEAM_COLORS.sage,
  codex: BEAM_COLORS.sand,
  gemini: BEAM_COLORS.blue,
  copilot: BEAM_COLORS.mauve,
  opencode: BEAM_COLORS.clay,
};

export function Figure({
  ground,
  color,
  playing,
  badge,
  conductor = false,
}: {
  ground: Vec2;
  color: string;
  /** Arms move: a player bows, a conductor beats time. */
  playing: boolean;
  /** Something to say over the head: a glyph in a colour. */
  badge?: { glyph: string; color: string } | null;
  conductor?: boolean;
}) {
  const [x, y] = project([...ground, 0]);
  const s = conductor ? 1.15 : 1;
  const bodyW = 15 * s;
  const bodyH = 26 * s;
  const headR = 6.5 * s;
  const shoulderY = y - bodyH + 6 * s;
  const vars = { '--orchestra-figure': color } as CSSProperties;
  return (
    <g
      className={
        conductor
          ? 'orchestra-figure orchestra-figure--conductor'
          : 'orchestra-figure'
      }
      data-playing={playing ? 'true' : 'false'}
      style={vars}
    >
      <ellipse
        cx={x}
        cy={y}
        rx={bodyW * 0.7}
        ry={bodyW * 0.28}
        className="orchestra-figure-shadow"
      />
      <rect
        x={x - bodyW / 2}
        y={y - bodyH}
        width={bodyW}
        height={bodyH}
        rx={bodyW / 2}
        className="orchestra-figure-body"
      />
      <line
        x1={x - bodyW / 2 + 1}
        y1={shoulderY}
        x2={x - bodyW / 2 - 7 * s}
        y2={shoulderY + 12 * s}
        className="orchestra-arm orchestra-arm--left"
        style={{ transformOrigin: `${x - bodyW / 2 + 1}px ${shoulderY}px` }}
      />
      <g
        className="orchestra-arm orchestra-arm--right"
        style={{ transformOrigin: `${x + bodyW / 2 - 1}px ${shoulderY}px` }}
      >
        <line
          x1={x + bodyW / 2 - 1}
          y1={shoulderY}
          x2={x + bodyW / 2 + 8 * s}
          y2={shoulderY + 11 * s}
        />
        {conductor && (
          <>
            <line
              x1={x + bodyW / 2 + 8 * s}
              y1={shoulderY + 11 * s}
              x2={x + bodyW / 2 + 22 * s}
              y2={shoulderY - 4 * s}
              className="orchestra-baton-line"
            />
            <circle
              cx={x + bodyW / 2 + 22 * s}
              cy={shoulderY - 4 * s}
              r="1.8"
              className="orchestra-baton-tip"
            />
          </>
        )}
      </g>
      <circle
        cx={x}
        cy={y - bodyH - headR + 2 * s}
        r={headR}
        className="orchestra-figure-head"
      />
      {conductor && (
        <path
          d={`M${x - 4},${y - bodyH + 2} l4,2 l4,-2 l-4,5 z`}
          className="orchestra-bowtie"
        />
      )}
      {badge && (
        <g className="orchestra-badge" style={{ color: badge.color }}>
          <rect
            x={x - 9}
            y={y - bodyH - headR * 2 - 16}
            width="18"
            height="15"
            rx="4"
          />
          <text x={x} y={y - bodyH - headR * 2 - 5}>
            {badge.glyph}
          </text>
        </g>
      )}
    </g>
  );
}

/** A player's name, on the floor in front of the stand. */
export function Nameplate({
  ground,
  branch,
  agent,
}: {
  ground: Vec2;
  branch: string;
  agent: string;
}) {
  const [x, y] = project([...ground, 0]);
  return (
    <g className="orchestra-nameplate">
      <text x={x} y={y + 12}>
        {branch}
      </text>
      <text x={x} y={y + 22} className="orchestra-nameplate-agent">
        {agent}
      </text>
    </g>
  );
}
