'use client';

import { Pause, Play } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

/**
 * n10 Desktop itself, running in the page on sample data: the desktop
 * renderer built with an in-page mock host (apps/desktop/src/renderer/
 * demo, copied here by `website:sync-demo`). It is laid out at a
 * desktop window's size and scaled to fit, so the page shows the app's
 * real layout at any width. Below the width where the scaled app is
 * still usable, it is shown as a live picture and takes no input.
 *
 * The page tells it two things by message: whether to play (paused off
 * screen and by the button) and the theme, when the site's changes.
 */
const SRC = '/desktop-demo/demo/index.html';
const WINDOW = { width: 1280, height: 800 };
/** Below this scale the app's text is too small to use. */
const INTERACTIVE_SCALE = 0.55;
const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function send(frame: HTMLIFrameElement | null, message: object): void {
  frame?.contentWindow?.postMessage(
    { type: 'n10-demo', ...message },
    window.location.origin
  );
}

function useScale(ref: RefObject<HTMLElement | null>): number {
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale((entry?.contentRect.width ?? 0) / WINDOW.width)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? false)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export function DesktopDemo({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scale = useScale(box);
  const inView = useInView(box);
  const { resolvedTheme } = useTheme();
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
  const [paused, setPaused] = useState(false);
  const playing = inView && !paused;
  const interactive = scale >= INTERACTIVE_SCALE;

  useEffect(() => send(frame.current, { playing }), [playing]);

  useEffect(() => {
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      send(frame.current, { theme: resolvedTheme });
    }
  }, [resolvedTheme]);

  const Icon = paused ? Play : Pause;

  return (
    <figure className={className}>
      <div
        ref={box}
        className="n10-frame bg-fd-card relative w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: `${WINDOW.width} / ${WINDOW.height}` }}
      >
        <iframe
          ref={frame}
          src={SRC}
          title="n10 Desktop, running on sample data"
          loading="lazy"
          tabIndex={interactive ? 0 : -1}
          inert={!interactive}
          onLoad={(event) => send(event.currentTarget, { playing })}
          className="absolute top-0 left-0 origin-top-left border-0"
          style={{
            width: WINDOW.width,
            height: WINDOW.height,
            transform: `scale(${scale})`,
            visibility: scale ? 'visible' : 'hidden',
          }}
        />
      </div>
      <figcaption className="text-fd-muted-foreground mt-3 flex items-center justify-center gap-2 text-sm text-pretty">
        <span>
          {interactive
            ? 'The real n10 Desktop on sample data from n10’s own pull requests. Click around: the agents are scripted and nothing leaves the page.'
            : 'The real n10 Desktop on sample data. Open this page on a wider screen to click around.'}
        </span>
        {!reduced && (
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? 'Play the demo' : 'Pause the demo'}
            className="hover:bg-fd-accent hover:text-fd-foreground focus-visible:ring-fd-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
          >
            <Icon className="size-4" aria-hidden />
          </button>
        )}
      </figcaption>
    </figure>
  );
}
