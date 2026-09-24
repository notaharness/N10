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
 * status, launches a note between machine and laptop, and puts a
 * bubble over the machine it concerns: a report as soon as it is sent,
 * an answer or assignment once its note lands. Pausing simply stops
 * scheduling the next event.
 */
export interface Bubble {
  key: number;
  color: string;
  head: string;
  text: string;
}

export interface Flight {
  key: number;
  from: Vec2;
  to: Vec2;
  color: string;
  glyph: string;
  /** The player it lands on, if it is an instruction rather than a report. */
  lands?: string;
  /** Shown over that player once the note has landed. */
  bubble?: Bubble;
}

export interface Show {
  next: number;
  serial: number;
  status: Record<string, Status>;
  flights: Flight[];
  /** The latest line said to or by each player. */
  bubbles: Record<string, Bubble>;
  /** Instructions landed per player; a change shakes the machine. */
  hits: Record<string, number>;
}

export type Action =
  | { type: 'event'; event: Event }
  | { type: 'landed'; key: number };

function playerOf(id: string): PlayerSpec {
  return PLAYERS.find((p) => p.id === id) as PlayerSpec;
}

function landed(show: Show, key: number): Show {
  const flight = show.flights.find((f) => f.key === key);
  const flights = show.flights.filter((f) => f.key !== key);
  if (!flight?.lands) return { ...show, flights };
  const id = flight.lands;
  return {
    ...show,
    flights,
    hits: { ...show.hits, [id]: (show.hits[id] ?? 0) + 1 },
    bubbles: flight.bubble
      ? { ...show.bubbles, [id]: flight.bubble }
      : show.bubbles,
  };
}

const STATUS_OF: Record<string, Status> = {
  QUESTION: 'question',
  BLOCKED: 'blocked',
  DONE: 'done',
  PROGRESS: 'working',
};

function reduce(show: Show, action: Action): Show {
  if (action.type === 'landed') return landed(show, action.key);
  const { event } = action;
  const spec = playerOf(event.player);
  const key = show.serial;
  const next = (show.next + 1) % SCRIPT.length;
  if ('report' in event) {
    const color = KIND_COLOR[event.report];
    return {
      next,
      serial: key + 1,
      hits: show.hits,
      status: { ...show.status, [spec.id]: STATUS_OF[event.report] as Status },
      flights: [
        ...show.flights,
        { key, from: machineTop(spec), to: podiumTop, color, glyph: '♪' },
      ],
      bubbles: {
        ...show.bubbles,
        [spec.id]: { key, color, head: event.report, text: event.text },
      },
    };
  }
  const bubble: Bubble =
    'reply' in event
      ? {
          key,
          color: BEAM_COLORS.sand,
          head: 'orchestrator',
          text: event.reply,
        }
      : { key, color: BEAM_COLORS.sand, head: 'new task', text: event.assign };
  return {
    next,
    serial: key + 1,
    hits: show.hits,
    bubbles: show.bubbles,
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
        bubble,
      },
    ],
  };
}

const opening: Show = {
  next: 0,
  serial: 1,
  status: Object.fromEntries(PLAYERS.map((p) => [p.id, 'working'])),
  flights: [],
  bubbles: {},
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
