import { BeamStreamsDiagram } from '@/components/beam/beam-streams-diagram';

const streams = [
  {
    name: 'beam connect',
    title: 'Open an interactive terminal',
    description:
      'Open a terminal on another machine in your fleet and run a shell or a tmux client in it. It resizes with your window.',
  },
  {
    name: 'beam exec',
    title: 'Run one command',
    description:
      'Run one command on another machine, like ssh host cmd. Input and output are piped through, and beam exec exits with the remote exit code.',
  },
  {
    name: 'beam msg',
    title: 'Queue a message',
    description:
      'Leave a message for a machine that is asleep or offline. Beam stores it on disk and delivers it when the machine returns.',
  },
];

export function BeamStreams() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Three ways to reach a machine in your fleet
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
