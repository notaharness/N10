import { CapturePlaceholder } from './capture-placeholder';

const COMMANDS = ['tmux ls', 'tmux attach -t my-project-fix-login-timeout'];

/** Sessions are ordinary tmux sessions: the claim skeptics check first. */
export function TmuxSection() {
  return (
    <section className="border-fd-border border-y">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-12 md:gap-14 sm:py-24">
        <div className="min-w-0 md:col-span-5">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            It&apos;s just tmux
          </h2>
          <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
            Every agent and terminal n10 starts is an ordinary session on your
            tmux server; an agent&apos;s is named after the repository and
            branch. Quitting n10 detaches and the agents keep running. Attach
            from any terminal, or reopen n10 and it reconnects.
          </p>
          <pre className="border-fd-border bg-fd-card mt-6 overflow-x-auto rounded-lg border px-4 py-3 font-mono text-[13px]">
            {COMMANDS.map((command) => (
              <span key={command} className="block">
                <span className="text-fd-primary/70 select-none">$ </span>
                {command}
              </span>
            ))}
          </pre>
        </div>
        <div className="min-w-0 md:col-span-7">
          <CapturePlaceholder>
            A terminal running <code>tmux ls</code> beside n10 Desktop, showing
            the same sessions.
          </CapturePlaceholder>
        </div>
      </div>
    </section>
  );
}
