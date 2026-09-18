const commands = [
  { label: 'Desktop app', command: 'npm install -g @notaharness/n10-desktop' },
  { label: 'Terminal UI and CLI', command: 'npm install -g @notaharness/n10' },
  {
    label: 'Beam (remote agents)',
    command: 'npm install -g @notaharness/beam',
  },
];

export function InstallStrip() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <div className="divide-fd-border overflow-hidden rounded-lg border border-fd-border divide-y bg-fd-card">
        {commands.map(({ label, command }) => (
          <div
            key={label}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <span className="text-fd-muted-foreground text-xs uppercase tracking-wide">
              {label}
            </span>
            <code className="font-mono text-sm">{command}</code>
          </div>
        ))}
      </div>
      <p className="text-fd-muted-foreground mt-3 text-center text-sm">
        Works with Claude, Codex, Gemini, Copilot and OpenCode &middot; GitHub
        and Azure DevOps
      </p>
    </section>
  );
}
