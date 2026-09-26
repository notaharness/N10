import { useState, type KeyboardEvent } from 'react';
import { ClaudeBlock } from '@/components/demo/claude-blocks';
import type { ClaudeView, Gate } from '@/components/demo/model';

/**
 * A Claude Code session: the transcript, the spinner line while it
 * works, and below them either the input box or, when a permission
 * prompt is open, the prompt in its place. The prompt is live: pick an
 * option with the mouse, the arrow keys and Enter, or its number.
 */
function tokens(ms: number): string {
  const n = Math.round(ms / 25);
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

function Spinner({ verb, ms }: { verb: string; ms: number }) {
  return (
    <div>
      <span className="n10-t-claude">
        <span className="n10-t-spinner" aria-hidden />
        {` ${verb}…`}
      </span>
      <span className="n10-t-dim">
        {` (${Math.floor(ms / 1000)}s · ↓ ${tokens(
          ms
        )} tokens · esc to interrupt)`}
      </span>
    </div>
  );
}

function InputBox({ idle }: { idle: boolean }) {
  return (
    <div>
      <div className="n10-t-rule">
        ❯{' '}
        {idle ? (
          <span className="n10-t-dim">
            Try &quot;how does src/retry.ts work?&quot;
          </span>
        ) : (
          <span className="n10-t-cursor" aria-hidden />
        )}
      </div>
      <div className="n10-t-rule" />
      <div className="n10-t-accept">
        {'  ⏵⏵ accept edits on '}
        <span className="n10-t-dim">(shift+tab to cycle)</span>
      </div>
    </div>
  );
}

function Permission({
  gate,
  label,
  onAnswer,
}: {
  gate: Gate;
  label: string;
  onAnswer: (option: number) => void;
}) {
  const [focus, setFocus] = useState(0);
  /** The prompt unmounts once answered; keep focus where output appears. */
  const answer = (option: number, from: HTMLElement) => {
    from.closest<HTMLElement>('[role=region]')?.focus();
    onAnswer(option);
  };
  const move = (to: number, event: KeyboardEvent<HTMLDivElement>) => {
    const next = (to + gate.options.length) % gate.options.length;
    setFocus(next);
    const buttons = event.currentTarget.querySelectorAll('button');
    buttons[next]?.focus();
    event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const digit = Number(event.key);
    const from = event.currentTarget;
    if (digit >= 1 && digit <= gate.options.length) answer(digit - 1, from);
    else if (event.key === 'ArrowDown') move(focus + 1, event);
    else if (event.key === 'ArrowUp') move(focus - 1, event);
    else if (event.key === 'Escape') answer(gate.reject, from);
  };
  return (
    <div className="n10-t-rule">
      <div className="n10-t-bold n10-t-code">Bash command</div>
      <div className="mt-[1lh] pl-[2ch]">{gate.command}</div>
      <div className="n10-t-dim pl-[2ch]">{gate.why}</div>
      <div className="mt-[1lh]" id={`${label}-question`}>
        Do you want to proceed?
      </div>
      <div
        role="group"
        aria-labelledby={`${label}-question`}
        onKeyDown={onKeyDown}
      >
        {gate.options.map((option, i) => (
          <button
            key={option}
            type="button"
            tabIndex={i === focus ? 0 : -1}
            onClick={(event) => answer(i, event.currentTarget)}
            onFocus={() => setFocus(i)}
            onMouseEnter={() => setFocus(i)}
            className={`block w-full text-left outline-none ${
              i === focus ? 'n10-t-code' : ''
            }`}
          >
            {i === focus ? '❯ ' : '  '}
            {i + 1}. {option}
          </button>
        ))}
      </div>
      <div className="n10-t-dim mt-[1lh]">Esc to cancel · Tab to amend</div>
    </div>
  );
}

export function ClaudeSession({
  view,
  now,
  label,
  onAnswer,
}: {
  view: ClaudeView;
  now: number;
  label: string;
  onAnswer: (option: number) => void;
}) {
  return (
    <div className="flex flex-col gap-[1lh]">
      {view.blocks.map(({ id, block }) => (
        <ClaudeBlock key={id} block={block} />
      ))}
      {view.working && (
        <Spinner verb={view.working.verb} ms={now - view.working.since} />
      )}
      {view.gate ? (
        <Permission gate={view.gate} label={label} onAnswer={onAnswer} />
      ) : (
        <InputBox idle={view.state === 'idle'} />
      )}
    </div>
  );
}
