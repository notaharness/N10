import { useEffect, useReducer } from 'react';
import type { Vec2 } from '@/components/beam/mesh/geometry';
import { BEAM_COLORS } from '@/components/beam/mesh/palette';
import { machineTop, podiumTop } from '@/components/orchestra/stage-parts';
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
  /** The player it lands on, if it is an instruction rather than a report. */
  lands?: string;
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
  /** Instructions landed per player; a change shakes the machine. */
  hits: Record<string, number>;
}

export type Action =
  | { type: 'event'; event: Event }
  | { type: 'landed'; key: number };

function playerOf(id: string): PlayerSpec {
  return PLAYERS.find((p) => p.id === id) as PlayerSpec;
}

function reduce(show: Show, action: Action): Show {
  if (action.type === 'landed') {
    const landed = show.flights.find((f) => f.key === action.key);
    const hits = landed?.lands
      ? { ...show.hits, [landed.lands]: (show.hits[landed.lands] ?? 0) + 1 }
      : show.hits;
    return {
      ...show,
      hits,
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
      hits: show.hits,
      status: { ...show.status, [spec.id]: status },
      flights: [
        ...show.flights,
        { key, from: machineTop(spec), to: podiumTop, color, glyph: '♪' },
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
    hits: show.hits,
    status: { ...show.status, [spec.id]: 'working' },
    flights: [
      ...show.flights,
      {
        key,
        from: podiumTop,
        to: machineTop(spec),
        color: BEAM_COLORS.sand,
        glyph: '♫',
        lands: spec.id,
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
  hits: {},
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
