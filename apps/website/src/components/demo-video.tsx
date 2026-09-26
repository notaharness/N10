'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * A looping feature demo. Under prefers-reduced-motion it doesn't
 * autoplay: the poster shows, with controls to play it. `autoplay` is
 * never server-rendered, since the browser would act on it before
 * hydration could take it back; playback starts from an effect instead.
 */
export function DemoVideo({
  name,
  alt,
  className,
}: {
  name: string;
  alt: string;
  className?: string;
}) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => true
  );
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    // Rejected when the browser's autoplay policy says no; the poster stays.
    const video = ref.current;
    if (!video) return;
    if (reduced) video.pause();
    else video.play().catch(() => undefined);
  }, [reduced]);
  return (
    <video
      ref={ref}
      className={className}
      controls={reduced}
      muted
      loop
      playsInline
      preload="none"
      poster={`/media/${name}-poster.webp`}
      aria-label={alt}
    >
      <source src={`/media/${name}.webm`} type="video/webm" />
      <source src={`/media/${name}.mp4`} type="video/mp4" />
    </video>
  );
}
