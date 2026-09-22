const notes = [
  {
    title: 'Built into n10 and Orchestra',
    description:
      'After pairing, n10 Desktop can launch on a paired machine instead of a local repository. Orchestra scripts provide the same choice with --machine.',
  },
  {
    title: 'Treat pairing like an SSH key',
    description:
      'Both machines prove their identity before sending anything, which prevents another machine from impersonating either one. Pair only trusted machines and remove access with beam revoke.',
  },
  {
    title: 'Use Beam on its own',
    description:
      'Beam is also a standalone package with its own CLI. It does not depend on Git or tmux, so shell scripts can use it directly.',
  },
];

export function BeamNotes() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12">
      <div className="flex flex-col gap-6">
        {notes.map((note) => (
          <div key={note.title}>
            <h3 className="font-semibold">{note.title}</h3>
            <p className="text-fd-muted-foreground mt-1">{note.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
