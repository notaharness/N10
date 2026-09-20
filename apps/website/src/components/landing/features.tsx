import { FeatureSection, type Feature } from './feature-section';

const features: Feature[] = [
  {
    media: 'worktrees',
    label: 'Worktrees',
    href: '/docs/guides/worktrees',
    title: 'Work on several branches at once',
    description:
      "Each branch gets its own git worktree and agent session. The sidebar shows each worktree's pull request state, CI results, review status and conflict count, so you can keep several features in progress without stashing changes.",
  },
  {
    media: 'review',
    label: 'Agent reviews',
    href: '/docs/guides/agent-reviews',
    title: "Review an agent's draft comments",
    description:
      'Ask an agent to review a pull request. It adds draft comments to the relevant lines in the diff, and you work through them in severity order — edit, discard, skip or post each one, attributed to you.',
  },
  {
    media: 'plan',
    label: 'Plans',
    href: '/docs/guides/plans',
    title: 'Turn review comments into an agent task',
    description:
      'Select the review comments you want an agent to address and add them to a plan. Preview the full prompt before sending it to your agent as a single task.',
  },
  {
    media: 'babysit',
    label: 'Babysit',
    href: '/docs/guides/babysit',
    title: 'Babysit a pull request',
    description:
      'Right-click a pull request and choose Babysit to keep your agent updated on CI results, unresolved review comments and merge conflicts, grouped and sent when the agent is idle.',
  },
  {
    media: 'review-in-place',
    label: 'Code review',
    href: '/docs/guides/reviewing-code',
    title: 'Review code without leaving n10',
    description:
      "Read a pull request's description, browse its diff and submit your review in n10 — reply to comments, resolve or reopen threads, and switch between split and unified diff views.",
  },
  {
    media: 'theme',
    label: 'Themes',
    href: '/docs/guides/themes',
    title: 'Light and dark themes',
    description: 'The most important feature of any software.',
  },
  {
    media: 'tui',
    label: 'Terminal UI',
    href: '/docs/terminal-ui',
    title: 'The terminal UI',
    alt: 'The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent',
    description: (
      <>
        Run <code>n10</code> from your repository root to open the terminal UI.
        It shares the desktop app&apos;s core, configuration and worktrees, so
        you can use either interface with the same projects. Most development
        now focuses on the desktop app; some features, such as whole-file diffs,
        are only available there.
      </>
    ),
  },
];

export function Features() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-24 px-4 py-20 sm:gap-32 sm:py-28">
      {features.map((feature, i) => (
        <FeatureSection key={feature.media} {...feature} index={i} />
      ))}
    </section>
  );
}
