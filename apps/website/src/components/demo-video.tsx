'use client';

import { useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * A looping feature demo. Under prefers-reduced-motion it doesn't
 * autoplay: the poster shows, with controls to play it.
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
    () => false
  );
  return (
    <video
      className={className}
      autoPlay={!reduced}
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
