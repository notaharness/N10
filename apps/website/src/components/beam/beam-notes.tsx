const notes = [
  {
    title: 'Built into n10 and Orchestra',
    description:
      "n10 Desktop's Fleet view creates or joins a fleet. Once another machine is in it, n10 Desktop can launch a worktree, agent or terminal there. Orchestra does the same with --machine.",
  },
  {
    title: 'Guard the passkey',
    description:
      'One passkey signs every membership, and by default any machine in the fleet can open a shell on the others. The directory at beam.n10.is stores only ciphertext. Show a QR code only where you alone can see it. Remove a machine with beam revoke. For a machine that should only send reports, set its grant to msg with beam peer grant.',
  },
  {
    title: 'Use Beam on its own',
    description:
      'Beam is a standalone npm package. One Go binary is both the daemon and the CLI. It needs no Git or tmux and runs on macOS and Linux.',
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
