import { CopyButton } from '@/components/copy-button';

const INSTALL = 'npm install -g @notaharness/n10';

const worksWith = [
  'Claude',
  'Codex',
  'Gemini',
  'Copilot',
  'OpenCode',
  'GitHub',
  'Azure DevOps',
];

export function InstallStrip() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="n10-frame bg-fd-card flex items-center gap-3 overflow-hidden rounded-xl py-2.5 pr-2.5 pl-4 sm:pl-5">
        <div className="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-0.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-fd-muted-foreground text-xs font-medium">
            n10 Desktop and terminal UI
          </span>
          <code className="overflow-x-auto font-mono text-[13px] whitespace-nowrap sm:text-sm">
            <span className="text-fd-primary/70 select-none">$ </span>
            {INSTALL}
          </code>
        </div>
        <CopyButton text={INSTALL} label="Copy the install command" />
      </div>
      <ul className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <li className="text-fd-muted-foreground mr-1 text-sm">Works with</li>
        {worksWith.map((name) => (
          <li
            key={name}
            className="border-fd-border bg-fd-card rounded-full border px-3 py-1 text-xs font-medium"
          >
            {name}
          </li>
        ))}
      </ul>
      <p className="text-fd-muted-foreground mt-3 text-center text-xs">
        Linux and macOS ·{' '}
        <a
          href="https://github.com/notaharness/n10/blob/master/LICENSE"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          MIT licensed
        </a>
      </p>
    </section>
  );
}
