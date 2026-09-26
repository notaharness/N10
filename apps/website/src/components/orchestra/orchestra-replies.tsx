/**
 * One pair of real orchestrator replies from the benchmark in
 * notaharness/plugins#9, from two drafts of the unreleased guidance
 * (9da6d10 and 242d759): the same scripted message at the same point in
 * the run, quoted exactly as the PR records them, backticks included
 * (backticked spans render as code). Each side is a list because the
 * replies are quoted in parts.
 */
const pair = {
  moment: 'After a silence, you answer only “yes ellipsis”',
  before: [
    "I've told the truncate player to add a single `…` that counts toward `n`",
    "OK to merge `fix/parse-duration` into main? It's verified: a 1-line fix plus tests, and all 4 pass.",
  ],
  after: [
    '`truncate("hello world", 5)` returns "hell…"',
    'should slugs be ASCII-only ("cafe-uber") or keep Unicode letters ("café-über")?',
  ],
};

/** Renders `backticked` spans as code, the rest as text. */
function withCode(line: string) {
  return line
    .split('`')
    .map((part, i) => (i % 2 === 1 ? <code key={part}>{part}</code> : part));
}

function Quotes({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-fd-muted-foreground font-mono text-xs">{label}</p>
      {lines.map((line) => (
        <blockquote
          key={line}
          className="border-fd-border mt-1.5 border-l-2 pl-3 text-sm"
        >
          “{withCode(line)}”
        </blockquote>
      ))}
    </div>
  );
}

export function OrchestraReplies() {
  return (
    <div className="mt-8">
      <div className="border-fd-border bg-fd-card rounded-xl border p-4 sm:p-5">
        <p className="text-sm font-medium">{pair.moment}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Quotes label="Earlier draft (9da6d10)" lines={pair.before} />
          <Quotes label="Later draft (242d759)" lines={pair.after} />
        </div>
      </div>
      <p className="text-fd-muted-foreground mt-3 text-xs text-pretty">
        Replies to the same message at the same point in the benchmark in
        plugins#9, one scripted run of each in a toy repository, quoted as
        written. Both are drafts of the unreleased guidance: the earlier one
        already contains plugins#8, and the guidance changed again after the
        later one. The earlier draft already gave useful context here. Neither
        benchmark showed a clear overall improvement. In{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/8"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          plugins#8
        </a>{' '}
        the new guidance still asked several decisions at checkpoints and
        repeated a pending question;{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/9"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          plugins#9
        </a>{' '}
        called its results mixed.
      </p>
    </div>
  );
}
