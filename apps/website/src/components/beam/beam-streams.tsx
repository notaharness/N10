const streams = [
  {
    name: 'beam connect',
    title: 'A real terminal',
    description:
      'Open a real, interactive terminal on the other machine — resize it, run a full shell, attach a tmux client to it. It behaves like the terminal you already have, just somewhere else.',
  },
  {
    name: 'beam exec',
    title: 'One command, and its result',
    description:
      'Run a single command on the other machine and get its output and exit code back, the same way ssh host cmd does. Scripts that already shell out to ssh can switch to this with barely any changes.',
  },
  {
    name: 'beam msg',
    title: 'Messages that wait for you',
    description:
      'Send a short message to a machine that happens to be asleep or off the network. Beam holds onto it on disk and delivers it the moment that machine comes back, so nothing gets lost in between.',
  },
];

export function BeamStreams() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold">
        Three ways to reach a paired machine
      </h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        {streams.map((stream) => (
          <div
            key={stream.name}
            className="border-fd-border bg-fd-card rounded-lg border p-5"
          >
            <code className="text-fd-primary font-mono text-sm">
              {stream.name}
            </code>
            <h3 className="mt-2 font-semibold">{stream.title}</h3>
            <p className="text-fd-muted-foreground mt-2 text-sm">
              {stream.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
