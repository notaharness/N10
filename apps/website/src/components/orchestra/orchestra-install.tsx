import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { buttonVariants } from '@/components/ui/button';

const routes = [
  {
    title: 'Claude Code',
    lines: [
      '/plugin marketplace add notaharness/plugins',
      '/plugin install orchestra@notaharness',
    ],
    then: 'Open Claude Code inside tmux and run /orchestra:orchestrator with a task.',
  },
  {
    title: 'Codex and other agents',
    lines: [
      'npx skills@latest add notaharness/plugins --global --skill orchestrator player',
    ],
    then: 'Start a new session and invoke $orchestrator. Install both skills in the same scope.',
  },
];

export function OrchestraInstall() {
  return (
    <section id="install" className="mx-auto w-full max-w-5xl px-4 pt-8 pb-24">
      <div className="border-fd-border bg-fd-card relative overflow-hidden rounded-2xl border px-6 py-14 sm:px-10">
        <div
          aria-hidden
          className="orchestra-panel-glow absolute inset-x-[15%] -top-20 h-40"
        />
        <div className="relative">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Install Orchestra
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {routes.map((route) => (
              <div key={route.title}>
                <h3 className="font-semibold">{route.title}</h3>
                <div className="n10-frame bg-fd-background mt-3 flex flex-col divide-y divide-fd-border overflow-hidden rounded-lg">
                  {route.lines.map((line) => (
                    <div
                      key={line}
                      className="flex items-center gap-2 py-1.5 pr-1.5 pl-4"
                    >
                      <code className="flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap">
                        {line}
                      </code>
                      <CopyButton text={line} label={`Copy: ${line}`} />
                    </div>
                  ))}
                </div>
                <p className="text-fd-muted-foreground mt-3 text-sm">
                  {route.then}
                </p>
              </div>
            ))}
          </div>
          <p className="text-fd-muted-foreground mx-auto mt-10 max-w-xl text-center text-sm text-pretty">
            Requires tmux 3.x, Git, python3 and an authenticated claude or codex
            CLI for each player type. Delivering reports into a Claude Code
            orchestrator&apos;s inbox needs OpenBSD nc or socat. Beam is only
            needed for players on other machines.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="https://github.com/notaharness/plugins/tree/main/orchestra#readme"
              className={buttonVariants()}
            >
              Read the README
            </Link>
            <Link
              href="/beam"
              className={buttonVariants({ variant: 'outline' })}
            >
              Add a machine with Beam
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
