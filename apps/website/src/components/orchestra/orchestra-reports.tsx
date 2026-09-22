const reports = [
  {
    kind: 'PROGRESS',
    color: 'var(--n10-sage)',
    title: 'A milestone',
    description:
      'The player reports progress such as passing tests, completing a section or opening a draft PR. The orchestrator can track the work without reading the player’s screen.',
  },
  {
    kind: 'QUESTION',
    color: 'var(--n10-sand)',
    title: 'A decision',
    description:
      'If the task allows two reasonable approaches, the player asks which to use. The orchestrator answers or passes the question to you.',
  },
  {
    kind: 'BLOCKED',
    color: '#d4896a',
    title: 'A blocker',
    description:
      'The player stops for missing credentials, failing dependencies or tests it cannot fix. It reports the problem instead of guessing.',
  },
  {
    kind: 'DONE',
    color: '#7da3c0',
    title: 'Finished, with caveats',
    description:
      'The player reports its results and what it did or did not verify. The orchestrator checks the commits, tests and PR.',
  },
];

export function OrchestraReports() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Four reports a player can send
      </h2>
      <p className="text-fd-muted-foreground mx-auto mt-3 max-w-2xl text-center text-pretty">
        Players work independently and send four kinds of reports. Each report
        appears in the orchestrator&apos;s conversation so it can respond.
      </p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {reports.map((report) => (
          <div
            key={report.kind}
            className="border-fd-border bg-fd-card relative overflow-hidden rounded-xl border p-6 pl-7"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1.5"
              style={{ background: report.color }}
            />
            <code className="font-mono text-sm" style={{ color: report.color }}>
              {report.kind}
            </code>
            <h3 className="mt-2 font-semibold">{report.title}</h3>
            <p className="text-fd-muted-foreground mt-2 text-sm">
              {report.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
