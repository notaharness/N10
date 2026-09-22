import { useEffect, useReducer } from 'react';
import { project, type Vec2 } from '@/components/beam/mesh/geometry';
import { BEAM_COLORS } from '@/components/beam/mesh/palette';
import { PODIUM, place } from '@/components/orchestra/stage-parts';
import {
  KIND_COLOR,
  LOOP_SECONDS,
  PLAYERS,
  SCRIPT,
  type Event,
  type PlayerSpec,
  type Status,
} from '@/components/orchestra/stage-script';

/**
 * Runs stage-script.ts: one event at a time, each scheduled from the
 * previous one's timestamp, looping. Each event updates a player's
 * status, launches a note between stand and podium, and appends a log
 * line. Pausing simply stops scheduling the next event.
 */
export interface Flight {
  key: number;
  from: Vec2;
  to: Vec2;
  color: string;
  glyph: string;
}

export interface LogLine {
  key: number;
  color: string;
  head: string;
  text: string;
}

export interface Show {
  next: number;
  serial: number;
  status: Record<string, Status>;
  flights: Flight[];
  log: LogLine[];
}

export type Action =
  | { type: 'event'; event: Event }
  | { type: 'landed'; key: number };

const podiumTop = project([PODIUM[0], PODIUM[1], 1.7]);

function lecternTop(spec: PlayerSpec): Vec2 {
  const at = place(spec.angle);
  return project([at.cx, at.cy, 1.9]);
}

function playerOf(id: string): PlayerSpec {
  return PLAYERS.find((p) => p.id === id) as PlayerSpec;
}

function reduce(show: Show, action: Action): Show {
  if (action.type === 'landed') {
    return {
      ...show,
      flights: show.flights.filter((f) => f.key !== action.key),
    };
  }
  const { event } = action;
  const spec = playerOf(event.player);
  const key = show.serial;
  const next = (show.next + 1) % SCRIPT.length;
  if ('report' in event) {
    const color = KIND_COLOR[event.report];
    const status: Status =
      event.report === 'QUESTION'
        ? 'question'
        : event.report === 'BLOCKED'
        ? 'blocked'
        : event.report === 'DONE'
        ? 'done'
        : 'working';
    return {
      next,
      serial: key + 1,
      status: { ...show.status, [spec.id]: status },
      flights: [
        ...show.flights,
        { key, from: lecternTop(spec), to: podiumTop, color, glyph: '♪' },
      ],
      log: [
        ...show.log,
        {
          key,
          color,
          head: `[player ${spec.session}] ${event.report}:`,
          text: event.text,
        },
      ].slice(-4),
    };
  }
  const text = 'reply' in event ? event.reply : event.assign;
  const head =
    'reply' in event
      ? `orchestrator → ${spec.session}:`
      : `orchestrator → ${spec.session}, new task:`;
  return {
    next,
    serial: key + 1,
    status: { ...show.status, [spec.id]: 'working' },
    flights: [
      ...show.flights,
      {
        key,
        from: podiumTop,
        to: lecternTop(spec),
        color: BEAM_COLORS.sand,
        glyph: '♫',
      },
    ],
    log: [
      ...show.log,
      { key, color: 'var(--color-fd-foreground)', head, text },
    ].slice(-4),
  };
}

const opening: Show = {
  next: 0,
  serial: 1,
  status: Object.fromEntries(PLAYERS.map((p) => [p.id, 'working'])),
  flights: [],
  log: [],
};

export function useShow(playing: boolean) {
  const [show, dispatch] = useReducer(reduce, opening);
  useEffect(() => {
    if (!playing) return;
    const event = SCRIPT[show.next] as Event;
    const prev =
      show.next === 0 ? SCRIPT[SCRIPT.length - 1] : SCRIPT[show.next - 1];
    const gap =
      show.next === 0
        ? LOOP_SECONDS - (prev as Event).t + event.t
        : event.t - (prev as Event).t;
    const timer = setTimeout(
      () => dispatch({ type: 'event', event }),
      gap * 1000
    );
    return () => clearTimeout(timer);
  }, [playing, show.next]);
  return { show, dispatch };
}
