import { Logo } from '@/components/logo';
import { ThemeImage } from '@/components/theme-image';
import { HeroTileBand } from '@/components/landing/hero-tile-band';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <HeroTileBand />
      <div className="relative z-10 mx-auto -mt-8 flex max-w-5xl flex-col items-center gap-6 px-4 pb-16 text-center sm:-mt-10 sm:pb-24">
        {/* Starts split and mixes on load; hover splits it again. */}
        <Logo intro hover className="h-20 w-auto sm:h-24" />
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Run coding agents across git worktrees
        </h1>
        <p className="text-fd-muted-foreground max-w-2xl text-lg">
          Track pull requests and review code from a desktop app or terminal UI.
          Each branch gets its own worktree and agent session, so you can keep
          several features in progress at once.
        </p>
        <ThemeImage
          name="hero"
          alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments"
          className="border-fd-border mt-8 w-full max-w-4xl rounded-lg border shadow-lg"
        />
      </div>
    </section>
  );
}
