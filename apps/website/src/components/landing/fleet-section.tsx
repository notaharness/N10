import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { BeamMesh } from '@/components/beam/mesh/beam-mesh';

/**
 * The optional extras: Fleet, which runs agents on your other machines
 * over Beam, and Orchestra. The Beam page's scene stands in for a demo,
 * clipped to a frame like the videos above it.
 */
export function FleetSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:pb-28">
      <div className="grid items-center gap-10 md:grid-cols-12 md:gap-14">
        <div className="min-w-0 md:col-span-5">
          <p className="font-mono text-xs tracking-wide">
            <span className="text-fd-primary">Optional</span>
            <span className="text-fd-muted-foreground"> / Fleet</span>
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Run an agent on another machine
          </h2>
          <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
            Join the machines you own into a fleet from n10 Desktop. Pick a
            machine when you launch, and the worktree, tmux session and agent
            run there.
          </p>
          <p className="text-fd-muted-foreground mt-3 leading-relaxed text-pretty">
            Fleet runs on Beam, which pools your machines with one passkey. No
            SSH keys and no Tailscale account, and your shells and commands
            never pass through beam.n10.is.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href="/docs/guides/fleet"
              className="text-fd-primary group inline-flex items-center gap-1 text-sm font-medium"
            >
              Read the guide
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
            <Link
              href="/beam"
              className="text-fd-primary group inline-flex items-center gap-1 text-sm font-medium"
            >
              About Beam
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>
          <p className="text-fd-muted-foreground mt-8 text-sm leading-relaxed text-pretty">
            Also optional:{' '}
            <Link
              href="/orchestra"
              className="hover:text-fd-foreground decoration-fd-border underline underline-offset-4 transition-colors"
            >
              Orchestra
            </Link>
            , which lets one agent hand work to other agents in their own
            worktrees. n10 lists them next to yours.
          </p>
        </div>
        <div className="relative min-w-0 md:col-span-7">
          <div
            aria-hidden
            className="n10-pane n10-pane--sand absolute top-6 -bottom-3 right-6 -left-3 rounded-xl"
          />
          <div className="n10-frame bg-fd-card relative overflow-hidden rounded-xl">
            <BeamMesh className="mx-auto w-full px-6 pt-4 pb-2" />
          </div>
        </div>
      </div>
    </section>
  );
}
