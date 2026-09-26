import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { BeamMesh } from '@/components/beam/mesh/beam-mesh';

/**
 * The one feature that reaches past this machine: n10 Desktop joins
 * the machines you own into a fleet over Beam and launches an agent on
 * whichever one you pick. The Beam page's scene stands in for a demo,
 * clipped to a frame like the videos above it.
 */
export function FleetSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:pb-28">
      <div className="grid items-center gap-10 md:grid-cols-12 md:gap-14">
        <div className="min-w-0 md:col-span-5">
          <p className="font-mono text-xs tracking-wide">
            <span className="text-fd-primary">08</span>
            <span className="text-fd-muted-foreground"> / Fleet</span>
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Run an agent on another machine
          </h2>
          <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
            Open Fleet in n10 Desktop to join the machines you own into a fleet
            with one passkey. Pick a machine when you launch, and the worktree,
            the tmux session and the agent run there. Reports from an agent on
            another machine land in your session here.
          </p>
          <p className="text-fd-muted-foreground mt-3 leading-relaxed text-pretty">
            Fleet runs on Beam, a small tool that pools your machines without
            SSH keys or a Tailscale account.
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
