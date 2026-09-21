const notes = [
  {
    title: 'Built into n10 and Orchestra',
    description:
      "Once two machines are paired, n10 Desktop's launch dialogs let you choose a paired machine just as you'd choose a local repository. On the command line, Orchestra's scripts offer a matching --machine flag.",
  },
  {
    title: 'Pair with the same care as an SSH key',
    description:
      'Both machines prove their identity before anything is sent, preventing a third party on the network from impersonating either side. Pair only machines you trust, and revoke access at any time with beam revoke.',
  },
  {
    title: 'More than an n10 dependency',
    description:
      'Beam ships as a standalone package with its own CLI. It knows nothing about Git or tmux, so you can build on it directly from a plain shell script.',
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
