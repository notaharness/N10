import { LogoTilePattern } from '@/components/logo-tile-pattern';

/**
 * Full-bleed decorative band above the hero copy: the mark tiled as a
 * rotated pattern (see logo-tile-pattern.tsx for why not repeated
 * elements — this can be as wide as the viewport), fading into the page
 * background by the time it reaches the heading. `left-1/2 w-screen
 * -translate-x-1/2` breaks out of the centered content column
 * regardless of how deep it's nested; it needs no ancestor to cooperate
 * beyond not clipping overflow.
 */
export function HeroTileBand() {
  return (
    <div className="relative left-1/2 h-40 w-screen -translate-x-1/2 overflow-hidden sm:h-56">
      <LogoTilePattern
        tileSize={26}
        id="n10-hero-tiles"
        className="absolute inset-0"
      />
      <div className="from-fd-background/0 via-fd-background/60 to-fd-background absolute inset-0 bg-gradient-to-b" />
    </div>
  );
}
