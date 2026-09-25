import Link from 'next/link';
import { FeatureSection, type Feature } from './feature-section';

const features: Feature[] = [
  {
    media: 'review',
    label: 'Agent reviews',
    href: '/docs/guides/agent-reviews',
    title: 'Review with an agent, post as yourself',
    description:
      'A review agent drafts comments on the diff of any pull request, yours or a colleague’s. Work through them by severity and edit, skip or post each one. Nothing is posted until you post it.',
  },
  {
    media: 'review-in-place',
    label: 'Code review',
    href: '/docs/guides/reviewing-code',
    title: 'Read the whole change',
    description:
      'Browse the diff split or unified, reply to and resolve threads, and submit your review. n10 Desktop also shows whole files, with unchanged code folded.',
  },
  {
    media: 'plan',
    label: 'Plans',
    href: '/docs/guides/plans',
    title: 'Send review comments to an agent',
    description:
      'Pick the review comments you want addressed, add a note to any of them, check the full prompt, and send it to the branch’s agent as one task.',
  },
  {
    media: 'babysit',
    label: 'Babysit',
    href: '/docs/guides/babysit',
    title: 'The part after the agent says “done”',
    description:
      'Babysit a pull request and n10 tells its agent when CI fails, reviewers comment or the branch conflicts. Updates are batched and sent when the agent is idle.',
  },
  {
    media: 'tui',
    label: 'Terminal UI',
    href: '/docs/terminal-ui',
    title: 'Or stay in the terminal',
    alt: 'The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent',
    description: (
      <>
        <code>n10 --tui</code> uses the same projects, configuration, worktrees
        and sessions as n10 Desktop. Some features, such as whole-file diffs,
        are desktop-only.
      </>
    ),
  },
];

export function Features() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
      <div className="flex flex-col gap-24 sm:gap-32">
        {features.map((feature, i) => (
          <FeatureSection
            key={feature.media}
            {...feature}
            reverse={i % 2 === 1}
          />
        ))}
      </div>
      <p className="text-fd-muted-foreground mt-16 text-center text-sm">
        Also:{' '}
        <Link
          href="/docs/guides/themes"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          light and dark themes
        </Link>
        , the most important feature of any software.
      </p>
    </section>
  );
}
