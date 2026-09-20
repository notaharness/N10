import { HeroBackdrop } from '@/components/hero-backdrop';
import { Logo } from '@/components/logo';
import { ThemeImage } from '@/components/theme-image';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop />
      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-4 pt-20 pb-16 text-center sm:pt-28 sm:pb-24">
        {/* Starts split and mixes on load; hover splits it again. */}
        <Logo intro hover className="h-20 w-auto sm:h-24" />
        <h1 className="mt-10 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Run coding agents across git worktrees
        </h1>
        <p className="text-fd-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
          Track pull requests and review code from a desktop app or terminal UI.
          Each branch gets its own worktree and agent session, so you can keep
          several features in progress at once.
        </p>
        <div className="relative mt-14 w-full sm:mt-16">
          <div
            aria-hidden
            className="n10-stage-glow absolute inset-x-[6%] -top-6 bottom-[35%]"
          />
          <ThemeImage
            name="hero"
            alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments"
            className="n10-frame relative w-full rounded-xl"
          />
        </div>
      </div>
    </section>
  );
}
