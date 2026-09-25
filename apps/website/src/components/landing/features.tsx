import { FeatureSection, type Feature } from './feature-section';

const features: Feature[] = [
  {
    media: 'worktrees',
    label: 'Worktrees',
    href: '/docs/guides/worktrees',
    title: 'Work on multiple branches at once',
    description:
      'Each branch gets its own Git worktree and agent session, so you do not need to stash changes. The sidebar shows pull request state, CI results, review status and conflicts.',
  },
  {
    media: 'review',
    label: 'Agent reviews',
    href: '/docs/guides/agent-reviews',
    title: "Review an agent's draft comments",
    description:
      'Ask an agent to review a pull request and add draft comments to its diff. Work through them by severity, then edit, discard, skip or post each comment under your name.',
  },
  {
    media: 'plan',
    label: 'Plans',
    href: '/docs/guides/plans',
    title: 'Send review comments to an agent',
    description:
      'Add selected review comments to a plan. Check the full prompt, then send it to your agent as one task.',
  },
  {
    media: 'babysit',
    label: 'Babysit',
    href: '/docs/guides/babysit',
    title: 'Babysit a pull request',
    description:
      'Right-click a pull request and choose Babysit. n10 groups CI results, unresolved review comments and merge conflicts, then sends them when the agent is idle.',
  },
  {
    media: 'review-in-place',
    label: 'Code review',
    href: '/docs/guides/reviewing-code',
    title: 'Review pull requests in n10',
    description:
      'Read the description, browse the diff and submit a review. Reply to comments, resolve or reopen threads, and use split or unified diffs.',
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
    title: 'Use the terminal UI',
    alt: 'The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent',
    description: (
      <>
        Run <code>n10 --tui</code> from your repository to open the terminal UI.
        It shares projects, configuration and worktrees with n10 Desktop. Some
        features, such as whole-file diffs, are desktop-only.
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
