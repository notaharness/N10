'use client';

import { Pause, Play } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { project } from '@/components/beam/mesh/geometry';
import {
  Beam,
  Ground,
  groundOf,
  Note,
  PODIUM,
  Player,
  Podium,
} from '@/components/orchestra/stage-parts';
import { PLAYERS } from '@/components/orchestra/stage-script';
import { useShow } from '@/components/orchestra/use-show';

/**
 * The pitch as a scene, built from the beam page's machines. The
 * orchestrator is a laptop at the top; the players are machines on an
 * arc below it, each joined to the laptop by its own straight two-lane
 * beam. A scripted timeline
 * (stage-script.ts) runs the show: a player asks a question and the
 * laptop answers, one gets blocked and unblocked, one finishes and is
 * handed a new assignment. Every report leaves its machine as a note
 * and lands on the laptop; every answer goes back the same way. The
 * log under the stage narrates in Orchestra's own report format.
 */
const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function OrchestraStage({ className }: { className?: string }) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduced;
  const { show, dispatch } = useShow(playing);
  const Icon = playing ? Pause : Play;
  const solids = [
    { key: 'podium', at: PODIUM, node: <Podium /> },
    ...PLAYERS.map((spec, index) => ({
      key: spec.id,
      at: groundOf(spec),
      node: (
        <Player
          spec={spec}
          status={show.status[spec.id] ?? 'working'}
          index={index}
          hits={show.hits[spec.id] ?? 0}
        />
      ),
    })),
  ].sort((a, b) => a.at[0] + a.at[1] - (b.at[0] + b.at[1]));
  const [px, py] = project([...PODIUM, 0]);

  return (
    <figure className={className}>
      <div className="relative">
        <svg
          viewBox={`${px - 360} ${py - 112} 720 380`}
          className="orchestra-stage h-auto w-full overflow-visible"
          data-playing={choice === null ? undefined : String(choice)}
          role="img"
          aria-label="A laptop at the top, and five machines on an arc below it, one player each, every one joined to the laptop by its own beam. Reports fly to the laptop as notes and answers fly back; a machine shakes when an answer lands on it."
        >
          <Ground />
          {PLAYERS.map((spec, i) => (
            <Beam key={spec.id} spec={spec} seconds={3 + i * 0.4} />
          ))}
          {solids.map((s) => (
            <g key={s.key}>{s.node}</g>
          ))}
          {show.flights.map((flight) => (
            <Note
              key={flight.key}
              flight={flight}
              onLanded={(key) => dispatch({ type: 'landed', key })}
            />
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
      <figcaption className="orchestra-log n10-frame bg-fd-card mx-auto mt-4 max-w-2xl rounded-xl px-4 py-3 font-mono text-xs">
        <ol
          className="flex min-h-[5.5rem] flex-col justify-end gap-1.5"
          aria-live="polite"
        >
          {show.log.length === 0 && (
            <li className="text-fd-muted-foreground">
              {playing ? 'five players working…' : 'press play to start'}
            </li>
          )}
          {show.log.map((line) => (
            <li
              key={line.key}
              className="orchestra-log-line text-fd-muted-foreground"
            >
              <span style={{ color: line.color }}>{line.head}</span> {line.text}
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
