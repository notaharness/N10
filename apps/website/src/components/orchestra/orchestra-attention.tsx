import { OrchestraReplies } from './orchestra-replies';

const sources = [
  {
    cite: 'Cowan (2001)',
    topic: 'working-memory capacity',
    href: 'https://doi.org/10.1017/S0140525X01003922',
  },
  {
    cite: 'Iqbal & Bailey (2008)',
    topic: 'interruptions at breakpoints',
    href: 'https://doi.org/10.1145/1357054.1357070',
  },
  {
    cite: 'Altmann & Trafton (2007)',
    topic: 'resuming an interrupted task',
    href: 'https://doi.org/10.3758/BF03193094',
  },
  {
    cite: 'Alderson et al. (2013)',
    topic: 'working memory in adults with ADHD',
    href: 'https://doi.org/10.1037/a0032371',
  },
  {
    cite: 'Amershi et al. (2019)',
    topic: 'Microsoft’s guidelines for human-AI interaction',
    href: 'https://doi.org/10.1145/3290605.3300233',
  },
];

/** How the orchestrator talks to you, and the research it draws on. */
export function OrchestraAttention() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        How the orchestrator talks to you
      </h2>
      <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
        Its messages are designed around research on attention and working
        memory. It keeps track of what you have acknowledged, asks for one
        decision at a time with a suggested default, and restates the state that
        decision needs, so you don&apos;t have to reread the thread. The design
        draws on this research; nobody has measured whether it helps.
      </p>
      <OrchestraReplies />
      <ul className="text-fd-muted-foreground mt-5 space-y-1.5 text-sm">
        {sources.map(({ cite, topic, href }) => (
          <li key={href}>
            <a
              href={href}
              className="text-fd-foreground hover:text-fd-primary underline decoration-fd-border underline-offset-4 transition-colors"
            >
              {cite}
            </a>
            , {topic}
          </li>
        ))}
      </ul>
      <p className="text-fd-muted-foreground mt-5 text-sm">
        The{' '}
        <a
          href="https://github.com/notaharness/plugins/tree/main/orchestra#communication-and-attention"
          className="text-fd-foreground hover:text-fd-primary underline decoration-fd-border underline-offset-4 transition-colors"
        >
          Orchestra README
        </a>{' '}
        has the full list.
      </p>
    </section>
  );
}
