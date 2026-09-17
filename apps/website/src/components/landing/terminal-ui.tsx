import { DemoVideo } from '@/components/demo-video';

export function TerminalUiSection() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16">
      <div className="grid items-center gap-8 md:grid-cols-2">
        <div>
          <h3 className="text-2xl font-semibold">The terminal UI</h3>
          <p className="text-fd-muted-foreground mt-3">
            Run <code>n10</code> from your repository root to open the terminal
            UI. It shares the desktop app&apos;s core, configuration and
            worktrees, so you can use either interface with the same projects.
            Most development now focuses on the desktop app; some features, such
            as whole-file diffs, are only available there.
          </p>
        </div>
        <DemoVideo
          name="tui"
          alt="The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent"
          className="w-full rounded-lg border border-fd-border shadow-sm"
        />
      </div>
    </section>
  );
}
