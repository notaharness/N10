const steps = [
  {
    title: 'Pair once',
    description:
      "Run beam serve on the machine you want to reach. Open the link it prints on your laptop, then confirm the fingerprint. That's it — the machines now know and trust each other.",
  },
  {
    title: 'Connect whenever you need to',
    description:
      'Either machine can dial the other — whichever direction the network allows. If neither is reachable, anything you send waits and arrives as soon as they reconnect.',
  },
  {
    title: 'Run the agent over there',
    description:
      'n10 and Orchestra work exactly as before: start tmux, check out a worktree, and launch an agent. Beam simply carries those calls to the other machine instead of running them locally.',
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
