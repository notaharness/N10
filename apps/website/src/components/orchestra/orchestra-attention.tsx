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
    href: 'https://doi.org/10.1037/a0031742',
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
        Coming next: how the orchestrator talks to you
      </h2>
      <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
        The next Orchestra release, in notaharness/plugins{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/8"
          className="text-fd-foreground hover:text-fd-primary underline decoration-fd-border underline-offset-4 transition-colors"
        >
          #8
        </a>{' '}
        and{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/9"
          className="text-fd-foreground hover:text-fd-primary underline decoration-fd-border underline-offset-4 transition-colors"
        >
          #9
        </a>
        , changes how the orchestrator writes to you. It keeps track of what you
        have acknowledged, asks for at most one decision per message with a
        suggested default, and restates the state that decision needs, so you
        don&apos;t have to reread the thread. The design draws on research on
        attention and working memory. Small benchmarks in those PRs haven&apos;t
        shown a clear improvement.
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
    </section>
  );
}
