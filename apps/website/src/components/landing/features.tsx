import { FeatureSection, type Feature } from './feature-section';

const features: Feature[] = [
  {
    media: 'worktrees',
    title: 'Work on several branches at once',
    description:
      "Each branch gets its own git worktree and agent session. The sidebar shows each worktree's pull request state, CI results, review status and conflict count, so you can keep several features in progress without stashing changes.",
  },
  {
    media: 'review',
    title: "Review an agent's draft comments",
    description:
      'Ask an agent to review a pull request. It adds draft comments to the relevant lines in the diff, and you work through them in severity order — edit, discard, skip or post each one, attributed to you.',
  },
  {
    media: 'plan',
    title: 'Turn review comments into an agent task',
    description:
      'Select the review comments you want an agent to address and add them to a plan. Preview the full prompt before sending it to your agent as a single task.',
  },
  {
    media: 'babysit',
    title: 'Babysit a pull request',
    description:
      'Right-click a pull request and choose Babysit to keep your agent updated on CI results, unresolved review comments and merge conflicts, grouped and sent when the agent is idle.',
  },
  {
    media: 'review-in-place',
    title: 'Review code without leaving n10',
    description:
      "Read a pull request's description, browse its diff and submit your review in n10 — reply to comments, resolve or reopen threads, and switch between split and unified diff views.",
  },
  {
    media: 'theme',
    title: 'Light and dark themes',
    description: 'The most important feature of any software.',
  },
];

export function Features() {
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-16">
      {features.map((feature, i) => (
        <FeatureSection
          key={feature.media}
          {...feature}
          reverse={i % 2 === 1}
        />
      ))}
    </section>
  );
}
