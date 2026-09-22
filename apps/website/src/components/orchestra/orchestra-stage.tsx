'use client';

import { Pause, Play } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { project, type Vec2 } from '@/components/beam/mesh/geometry';
import { BEAM_COLORS } from '@/components/beam/mesh/palette';
import { depth } from '@/components/orchestra/stage-geometry';
import {
  Lectern,
  Note,
  PODIUM,
  Podium,
  RemotePlatform,
  Riser,
  place,
} from '@/components/orchestra/stage-parts';
import { PLAYERS } from '@/components/orchestra/stage-script';
import { useShow } from '@/components/orchestra/use-show';

/**
 * The pitch as a scene, in the same isometric language as the beam
 * page. An orchestrator at a podium keeps a beat; players at lecterns on
 * a semicircular riser face it, screens bouncing while they work. A
 * scripted timeline (stage-script.ts) runs the show: a player asks a
 * question and the podium answers, one gets blocked and unblocked, one
 * finishes and is handed a new assignment. Every report leaves its stand
 * as a note and lands on the podium; every answer goes back the same
 * way. The log under the stage narrates in Orchestra's own report format.
 * One player stands on its own platform with a beam running off the
 * edge: it is on another machine, and nothing else about it differs.
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
  const remote = PLAYERS.find((p) => p.remote);
  const solids = [
    { key: 'podium', at: PODIUM, node: <Podium /> },
    ...PLAYERS.map((spec) => {
      const at = place(spec.angle);
      return {
        key: spec.id,
        at: [at.cx, at.cy] as Vec2,
        node: (
          <Lectern spec={spec} status={show.status[spec.id] ?? 'working'} />
        ),
      };
    }),
  ].sort((a, b) => depth(a.at) - depth(b.at));
  const [px, py] = project([...PODIUM, 0]);

  return (
    <figure className={className}>
      <div className="relative">
        <svg
          viewBox={`${px - 330} ${py - 125} 660 292`}
          className="orchestra-stage h-auto w-full overflow-visible"
          data-playing={choice === null ? undefined : String(choice)}
          role="img"
          aria-label="An orchestrator at a podium keeping a beat, with five players at lecterns on a semicircular riser facing it. Their screens bounce while they work; reports fly to the podium as notes and answers fly back. One player stands on its own platform, joined to the scene by a beam from another machine."
        >
          <defs>
            <radialGradient id="orchestra-pool">
              <stop
                offset="0"
                stopColor={BEAM_COLORS.sand}
                stopOpacity="0.45"
              />
              <stop
                offset="0.6"
                stopColor={BEAM_COLORS.sage}
                stopOpacity="0.12"
              />
              <stop offset="1" stopColor={BEAM_COLORS.sage} stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx={px}
            cy={py + 30}
            rx="330"
            ry="150"
            fill="url(#orchestra-pool)"
            className="orchestra-pool"
          />
          <Riser />
          {remote && <RemotePlatform spec={remote} />}
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
              {playing ? 'five players working…' : 'press play to run the show'}
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
