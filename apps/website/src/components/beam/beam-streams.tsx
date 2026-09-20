import { BeamStreamsDiagram } from '@/components/beam/beam-streams-diagram';

const streams = [
  {
    name: 'beam connect',
    title: 'A real, interactive terminal',
    description:
      "Open a real terminal on the other machine. Resize it, run a full shell, or attach a tmux client. It works like the terminal you already use — it's just running somewhere else.",
  },
  {
    name: 'beam exec',
    title: 'One command. One result.',
    description:
      'Run a single command on the other machine and get its output and exit code back — just like ssh host cmd. Scripts that already shell out to SSH can switch with barely any changes.',
  },
  {
    name: 'beam msg',
    title: 'Messages that can wait',
    description:
      'Send a short message even when the other machine is asleep or off the network. Beam keeps it on disk and delivers it when that machine returns, so nothing gets lost along the way.',
  },
];

export function BeamStreams() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Three ways to reach a paired machine
      </h2>
      <div className="mt-8">
        <BeamStreamsDiagram />
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        {streams.map((stream) => (
          <div
            key={stream.name}
            className="border-fd-border bg-fd-card rounded-xl border p-6"
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
