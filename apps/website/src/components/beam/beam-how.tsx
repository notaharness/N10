const steps = [
  {
    title: 'Create a fleet',
    description:
      'Run beam init --label laptop on the first machine. Two passkey prompts, in a browser or through a QR code on a terminal, create the fleet passkey and authorize the machine.',
  },
  {
    title: 'Join from each machine',
    description:
      'Run beam join --label buildbox and approve with the same passkey, from your phone if the machine is headless. Check that the fleet fingerprint it prints matches beam status on a machine already in the fleet.',
  },
  {
    title: 'Run the agent there',
    description:
      'n10 and Orchestra start tmux, create a worktree and launch an agent on the machine you name. Beam runs those calls there and returns the results.',
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
