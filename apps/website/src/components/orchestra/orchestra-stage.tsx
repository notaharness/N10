'use client';

import { Pause, Play } from 'lucide-react';
import { useState, useSyncExternalStore, type CSSProperties } from 'react';

/**
 * The pitch as a picture: a podium, and a semicircle of stands facing
 * it. Each stand is a player — a coding agent in its own tmux session
 * and worktree. Stands light up as their player works and send reports
 * back to the podium; one stand sits on another machine, and its beam
 * is the only thing that differs about it.
 *
 * Coordinates are plain SVG user units, podium near the top, stands on
 * an arc below it. Every stand runs the same work-then-report cycle
 * with its own duration and phase, so the stage never falls into
 * lockstep.
 */
const PODIUM: readonly [number, number] = [0, -70];
const RADIUS = 232;

type Kind = 'PROGRESS' | 'QUESTION' | 'BLOCKED' | 'DONE';

interface Stand {
  id: string;
  /** Degrees around the arc; 0 is straight below the podium. */
  angle: number;
  branch: string;
  agent: string;
  kind: Kind;
  /** Seconds for one work-then-report cycle. */
  seconds: number;
  /** Where in the cycle this stand starts, 0–1. */
  phase: number;
  remote?: boolean;
}

const stands: Stand[] = [
  {
    id: 'a',
    angle: -72,
    branch: 'feature/search',
    agent: 'claude',
    kind: 'PROGRESS',
    seconds: 9,
    phase: 0.1,
  },
  {
    id: 'b',
    angle: -34,
    branch: 'fix/flaky-restore',
    agent: 'codex',
    kind: 'DONE',
    seconds: 11,
    phase: 0.55,
  },
  {
    id: 'c',
    angle: 0,
    branch: 'feature/palette',
    agent: 'claude',
    kind: 'QUESTION',
    seconds: 8,
    phase: 0.8,
  },
  {
    id: 'd',
    angle: 34,
    branch: 'chore/deps',
    agent: 'gemini',
    kind: 'PROGRESS',
    seconds: 10,
    phase: 0.3,
  },
  {
    id: 'e',
    angle: 72,
    branch: 'feature/export',
    agent: 'claude',
    kind: 'BLOCKED',
    seconds: 12,
    phase: 0.65,
    remote: true,
  },
];

const KIND_COLOR: Record<Kind, string> = {
  PROGRESS: 'var(--n10-sage)',
  QUESTION: 'var(--n10-sand)',
  BLOCKED: '#d4896a',
  DONE: '#7da3c0',
};

function standAt(angle: number): readonly [number, number] {
  const rad = ((angle + 90) * Math.PI) / 180;
  return [
    PODIUM[0] + Math.cos(rad) * RADIUS,
    PODIUM[1] + Math.sin(rad) * RADIUS * 0.6,
  ];
}

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function Podium() {
  const [x, y] = PODIUM;
  return (
    <g className="orchestra-podium">
      <ellipse
        cx={x}
        cy={y + 30}
        rx="54"
        ry="14"
        className="orchestra-podium-shadow"
      />
      <path
        d={`M${x - 34},${y + 26} L${x - 26},${y - 14} L${x + 26},${y - 14} L${
          x + 34
        },${y + 26} Z`}
        className="orchestra-podium-body"
      />
      <rect
        x={x - 30}
        y={y - 22}
        width="60"
        height="10"
        rx="3"
        className="orchestra-podium-top"
      />
      <circle cx={x} cy={y - 44} r="10" className="orchestra-figure" />
      <path
        d={`M${x - 16},${y - 12} Q${x},${y - 34} ${x + 16},${y - 12}`}
        className="orchestra-figure"
      />
      <path
        d={`M${x + 14},${y - 26} L${x + 34},${y - 48}`}
        className="orchestra-baton"
      />
    </g>
  );
}

function StandFigure({ stand }: { stand: Stand }) {
  const [x, y] = standAt(stand.angle);
  const vars = {
    '--orchestra-seconds': `${stand.seconds}s`,
    '--orchestra-delay': `${-stand.phase * stand.seconds}s`,
    '--orchestra-kind': KIND_COLOR[stand.kind],
  } as CSSProperties;
  const [px, py] = PODIUM;
  const report = `M${x},${y - 30} Q${(x + px) / 2},${(y + py) / 2 - 60} ${px},${
    py - 10
  }`;
  return (
    <g className="orchestra-stand" style={vars}>
      {stand.remote && (
        <ellipse
          cx={x}
          cy={y + 22}
          rx="46"
          ry="14"
          className="orchestra-remote-beam"
        />
      )}
      <ellipse
        cx={x}
        cy={y + 22}
        rx="34"
        ry="9"
        className="orchestra-stand-shadow"
      />
      <path
        d={`M${x - 24},${y + 4} L${x + 24},${y + 4} L${x + 18},${y - 26} L${
          x - 18
        },${y - 26} Z`}
        className="orchestra-stand-desk"
      />
      <path
        d={`M${x},${y + 4} L${x},${y + 18}`}
        className="orchestra-stand-post"
      />
      <rect
        x={x - 16}
        y={y - 24}
        width="32"
        height="18"
        rx="2"
        className="orchestra-stand-screen"
      />
      <g className="orchestra-stand-lines">
        <line x1={x - 12} y1={y - 19} x2={x + 2} y2={y - 19} />
        <line x1={x - 12} y1={y - 15} x2={x + 8} y2={y - 15} />
        <line x1={x - 12} y1={y - 11} x2={x - 2} y2={y - 11} />
      </g>
      <circle cx={x} cy={y - 40} r="8" className="orchestra-player" />
      <path
        d={`M${x - 13},${y - 26} Q${x},${y - 40} ${x + 13},${y - 26}`}
        className="orchestra-player"
      />
      <path d={report} className="orchestra-report-path" />
      <circle r="4" className="orchestra-report">
        <animateMotion
          dur="var(--orchestra-seconds)"
          repeatCount="indefinite"
          path={report}
          keyPoints="0;0;1;1"
          keyTimes="0;0.72;0.9;1"
          calcMode="linear"
        />
      </circle>
      <text x={x} y={y + 40} className="orchestra-stand-label">
        {stand.branch}
      </text>
      <text x={x} y={y + 52} className="orchestra-stand-sub">
        {stand.agent} · {stand.kind}
      </text>
      {stand.remote && (
        <g className="orchestra-remote">
          <text x={x} y={y + 66} className="orchestra-remote-label">
            another machine
          </text>
          <text x={x} y={y + 77} className="orchestra-remote-label">
            via beam
          </text>
        </g>
      )}
    </g>
  );
}

export function OrchestraStage({ className }: { className?: string }) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduced;
  const Icon = playing ? Pause : Play;
  return (
    <figure className={className}>
      <div className="relative">
        <svg
          viewBox="-320 -150 640 296"
          className="orchestra-stage h-auto w-full overflow-visible"
          data-playing={choice === null ? undefined : String(choice)}
          role="img"
          aria-label="An orchestrator at a podium, with five players at stands around it. Each player works on its own branch and sends reports back to the podium; one player stands on another machine, connected by a beam."
        >
          <Podium />
          {stands.map((stand) => (
            <StandFigure key={stand.id} stand={stand} />
          ))}
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
