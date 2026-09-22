const steps = [
  {
    title: 'Pair once',
    description:
      'Run beam serve on the machine you want to reach. Open its link on your laptop and confirm the fingerprint to pair the machines.',
  },
  {
    title: 'Connect when needed',
    description:
      'Either machine can dial the other, depending on what the network allows. If neither is reachable, sent items wait until they reconnect.',
  },
  {
    title: 'Run the agent remotely',
    description:
      'n10 and Orchestra still start tmux, check out a worktree and launch an agent. Beam runs those calls on the paired machine instead of locally.',
  },
];

export function BeamHow() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        How Beam works
      </h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="border-fd-border bg-fd-card rounded-xl border p-6"
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
