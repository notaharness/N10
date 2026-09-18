const steps = [
  {
    title: 'Pair once',
    description:
      'Run beam serve on the machine you want to reach. It prints a link — open it from your laptop and confirm the fingerprint. From then on, both machines know and trust each other.',
  },
  {
    title: 'Reach it whenever you need to',
    description:
      'Either machine can dial the other, whichever way the network allows. If neither can reach the other right now, anything you send just waits and arrives the moment they reconnect.',
  },
  {
    title: 'The agent runs there, not here',
    description:
      'n10 and Orchestra still do the same thing they always did — start tmux, check out a worktree, launch an agent — beam just carries those calls to the other machine instead of running them locally.',
  },
];

export function BeamHow() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold">How it works</h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="border-fd-border bg-fd-card rounded-lg border p-5"
          >
            <div className="text-fd-primary font-mono text-sm font-semibold">
              {i + 1}
            </div>
            <h3 className="mt-2 font-semibold">{step.title}</h3>
            <p className="text-fd-muted-foreground mt-2 text-sm">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
