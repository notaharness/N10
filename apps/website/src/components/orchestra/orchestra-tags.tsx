import Link from 'next/link';

/**
 * The interoperability pitch: a player is nothing but a tmux session
 * with these tags on it, and n10 reads the same tags, so a session one
 * tool starts is a session the other one sees.
 */
const tags = [
  {
    name: '@orchestra-spawner',
    value: 'orchestra',
    note: 'or n10 — whichever program created the session',
  },
  { name: '@orchestra-repo', value: '/code/shop', note: 'the main checkout' },
  {
    name: '@orchestra-branch',
    value: 'feature/search',
    note: 'the branch, unsanitised',
  },
  {
    name: '@orchestra-session-type',
    value: 'worktree',
    note: 'every player; n10’s terminal tabs are shell or agent',
  },
  {
    name: '@orchestra-agent',
    value: 'claude',
    note: 'what is actually running in the pane',
  },
  {
    name: '@orchestra-orchestrator',
    value: 'tmux:planning',
    note: 'where reports go; beam:<peer>/… when that is another machine',
  },
  {
    name: '@orchestra-last-report',
    value: 'DONE 2026-09-21T14:02Z delivered',
    note: 'kind, time and outcome of the last report',
  },
];

const tools = [
  {
    name: 'n10',
    href: '/',
    blurb:
      'Reads the same tags to list every player in its sidebar, next to the worktrees it started itself. Launch a player from n10 Desktop, or adopt one Orchestra spawned — same session either way. On the desktop, n10 is also the relay that receives reports from other machines.',
  },
  {
    name: 'Beam',
    href: '/beam',
    blurb:
      'Adds --machine to every Orchestra script. Name a paired machine and the same tmux and Git commands run there instead; the player’s reports come back over the same pairing, and wait on disk if your laptop is closed.',
  },
];

export function OrchestraTags() {
  return (
    <section className="border-fd-border border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 md:grid-cols-12 md:gap-14 sm:py-20">
        <div className="md:col-span-5">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            A player is just a tmux session
          </h2>
          <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
            Everything Orchestra knows about a player lives on its tmux session
            as a handful of user options. No state files, no daemon. The tags
            die with the session, and anything that can reach the tmux server
            can read them.
          </p>
          <p className="text-fd-muted-foreground mt-4 leading-relaxed text-pretty">
            That is the whole interoperability story. n10 and Beam speak the
            same tags, so the three tools compose without knowing about each
            other&apos;s internals.
          </p>
          <div className="mt-8 flex flex-col gap-6">
            {tools.map((tool) => (
              <div key={tool.name}>
                <Link
                  href={tool.href}
                  className="text-fd-primary font-semibold hover:underline"
                >
                  {tool.name}
                </Link>
                <p className="text-fd-muted-foreground mt-1 text-sm leading-relaxed">
                  {tool.blurb}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-7">
          <div className="n10-frame bg-fd-card overflow-hidden rounded-xl">
            <div className="border-fd-border text-fd-muted-foreground flex items-center gap-2 border-b px-4 py-2 font-mono text-xs">
              <span className="size-2 rounded-full bg-[var(--n10-sage)]" />
              tmux session: shop-feature-search
            </div>
            <dl className="divide-fd-border divide-y">
              {tags.map((tag) => (
                <div key={tag.name} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-[13px]">
                    <dt className="text-fd-primary">{tag.name}</dt>
                    <dd>= {tag.value}</dd>
                  </div>
                  <p className="text-fd-muted-foreground mt-0.5 text-xs">
                    {tag.note}
                  </p>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
