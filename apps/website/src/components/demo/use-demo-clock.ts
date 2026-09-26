import {
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { ITEMS } from '@/components/demo/items';
import { capOf, type Answer, type Beat } from '@/components/demo/model';

/**
 * One clock per scripted session, all advanced by a single interval
 * while the demo is on screen and playing, so every agent keeps working
 * whether or not its tab is open. Under reduced motion the demo starts
 * "still": every session shows its end state (up to any unanswered
 * permission prompt) and nothing animates until the viewer presses play.
 */
const TICK_MS = 250;
const REDUCED = '(prefers-reduced-motion: reduce)';

const SCRIPTS: readonly [string, readonly Beat[]][] = ITEMS.flatMap((item) =>
  item.session === 'zsh' ? [] : [[item.id, item.session] as const]
);

interface Clock {
  elapsed: Record<string, number>;
  answers: Record<string, Answer>;
  /** The latest announcement, for the live region. */
  said: string;
}

type Action =
  | { type: 'tick' }
  | { type: 'answer'; id: string; option: number }
  | { type: 'replay' };

const START: Clock = { elapsed: {}, answers: {}, said: '' };

function announcedBetween(beats: readonly Beat[], from: number, to: number) {
  return beats.filter((b) => b.at > from && b.at <= to && b.announce).pop()
    ?.announce;
}

function tick(clock: Clock): Clock {
  const elapsed = { ...clock.elapsed };
  let said = clock.said;
  for (const [id, beats] of SCRIPTS) {
    const from = elapsed[id] ?? 0;
    const to = Math.min(from + TICK_MS, capOf(beats, clock.answers[id]));
    elapsed[id] = to;
    said = announcedBetween(beats, from, to) ?? said;
  }
  return { ...clock, elapsed, said };
}

function reduce(clock: Clock, action: Action): Clock {
  switch (action.type) {
    case 'tick':
      return tick(clock);
    case 'answer':
      return {
        ...clock,
        answers: { ...clock.answers, [action.id]: action.option },
      };
    case 'replay':
      return START;
  }
}

function finished(clock: Clock): boolean {
  return SCRIPTS.every(
    ([id, beats]) => (clock.elapsed[id] ?? 0) >= capOf(beats, clock.answers[id])
  );
}

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export function useDemoClock(ref: RefObject<HTMLElement | null>) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const [clock, dispatch] = useReducer(reduce, START);
  const inView = useInView(ref);
  const playing = choice ?? !reduced;
  const still = choice === null && reduced;
  const done = finished(clock);

  useEffect(() => {
    if (!playing || !inView || done) return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), TICK_MS);
    return () => clearInterval(timer);
  }, [playing, inView, done]);

  /** A session's clock; a still demo shows every session at its cap. */
  const timeOf = (id: string, beats: readonly Beat[]) =>
    still ? capOf(beats, clock.answers[id]) : clock.elapsed[id] ?? 0;

  return {
    playing,
    done,
    said: clock.said,
    answers: clock.answers,
    timeOf,
    togglePlaying: () => setChoice(!playing),
    answer: (id: string, option: number) =>
      dispatch({ type: 'answer', id, option }),
    replay: () => {
      dispatch({ type: 'replay' });
      setChoice(true);
    },
  };
}
