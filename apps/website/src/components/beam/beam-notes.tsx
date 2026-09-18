const notes = [
  {
    title: 'Works with n10 and Orchestra out of the box',
    description:
      "Once two machines are paired, n10 Desktop's launch dialogs let you pick a paired machine the same way you'd pick a local repository. Orchestra's scripts gained a matching --machine flag for the command line.",
  },
  {
    title: 'Pairing is like handing out an SSH key',
    description:
      "Both machines prove who they are before anything is sent, so a third party on the network can't impersonate either side. Only pair machines you trust, and revoke a machine any time with beam revoke.",
  },
  {
    title: 'A standalone tool, not just an n10 dependency',
    description:
      "Beam ships as its own package with its own CLI. It doesn't know what git or tmux are — you can build on it directly from a plain shell script.",
  },
];

export function BeamNotes() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
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
