const reports = [
  {
    kind: 'PROGRESS',
    color: 'var(--n10-sage)',
    title: 'A milestone',
    description:
      'Tests pass, a slice is wired up, a draft PR is open. Enough for the orchestrator to know the player is on track without reading its screen.',
  },
  {
    kind: 'QUESTION',
    color: 'var(--n10-sand)',
    title: 'A decision it needs',
    description:
      'Two reasonable ways to do something, and the task didn’t say which. The orchestrator answers, or relays the question to you.',
  },
  {
    kind: 'BLOCKED',
    color: '#d4896a',
    title: 'Something in the way',
    description:
      'A missing credential, a failing dependency, a test that can’t be made to pass. The player stops and says so instead of guessing.',
  },
  {
    kind: 'DONE',
    color: '#7da3c0',
    title: 'Finished, with caveats',
    description:
      'Results, what was verified and what wasn’t. The orchestrator checks the commits, the tests and the PR before believing it.',
  },
];

export function OrchestraReports() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-20">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Four things a player can say
      </h2>
      <p className="text-fd-muted-foreground mx-auto mt-3 max-w-2xl text-center text-pretty">
        A player doesn&apos;t chat. It works, and it sends one of four kinds of
        report to whoever is conducting it. Each lands in the
        orchestrator&apos;s conversation as a line it can act on.
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
