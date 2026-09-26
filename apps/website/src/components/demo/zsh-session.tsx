import { useState, type SubmitEvent } from 'react';
import { Lines } from '@/components/demo/term-line';
import { ZSH_BRANCH, ZSH_DIR, type ZshEntry } from '@/components/demo/zsh';

/**
 * robbyrussell's prompt: `➜  dir git:(branch) ✗`, the arrow red after
 * a failed command. The last prompt holds a real input, so the shell
 * takes typing; zsh.ts decides what each command prints.
 */
function PromptHead({ ok }: { ok: boolean }) {
  return (
    <>
      <span className={ok ? 'n10-t-bold n10-t-green' : 'n10-t-bold n10-t-red'}>
        ➜
      </span>
      {'  '}
      <span className="n10-t-cyan">{ZSH_DIR}</span>{' '}
      <span className="n10-t-bold n10-t-blue">git:(</span>
      <span className="n10-t-red">{ZSH_BRANCH}</span>
      <span className="n10-t-bold n10-t-blue">)</span>{' '}
      <span className="n10-t-yellow">✗</span>{' '}
    </>
  );
}

export function ZshSession({
  history,
  onRun,
  inputId,
}: {
  history: readonly (ZshEntry & { id: number })[];
  onRun: (line: string) => void;
  inputId: string;
}) {
  const [line, setLine] = useState('');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRun(line);
    setLine('');
  };
  return (
    <div>
      {history.map((entry, i) => (
        <div key={entry.id}>
          <div className="whitespace-pre-wrap">
            <PromptHead ok={history[i - 1]?.ok ?? true} />
            {entry.cmd}
          </div>
          {entry.out.length > 0 && <Lines lines={entry.out} />}
        </div>
      ))}
      <form onSubmit={submit} className="flex whitespace-pre">
        <span>
          <PromptHead ok={history[history.length - 1]?.ok ?? true} />
        </span>
        <label htmlFor={inputId} className="sr-only">
          Command for the zsh in perf-flamegraph (a pretend shell)
        </label>
        <input
          id={inputId}
          value={line}
          onChange={(event) => setLine(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          className="n10-t-input min-w-0 flex-1 bg-transparent p-0 outline-none"
        />
      </form>
    </div>
  );
}
