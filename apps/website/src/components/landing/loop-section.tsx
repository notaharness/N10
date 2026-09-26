import { CapturePlaceholder } from './capture-placeholder';

const steps = [
  'Create a worktree and start an agent in it',
  'The agent opens a pull request and CI goes red',
  'Babysit hands the failure back to the agent',
  'A review agent drafts comments on the diff',
  'You post two, discard one, and send them to the agent as a plan',
];

/** The whole loop, from new branch to addressed review, in one place. */
export function LoopSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
      <div className="grid items-center gap-10 md:grid-cols-12 md:gap-14">
        <div className="min-w-0 md:col-span-5">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            One pull request, start to finish
          </h2>
          <ol className="text-fd-muted-foreground mt-5 space-y-2.5 leading-relaxed">
            {steps.map((text, i) => (
              <li key={text} className="flex gap-3">
                <span className="text-fd-primary font-mono text-xs leading-7">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 md:col-span-7">
          <CapturePlaceholder>
            One uncut recording of these five steps on a real repository.
          </CapturePlaceholder>
        </div>
      </div>
    </section>
  );
}
