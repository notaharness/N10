import type { ReactNode } from 'react';
import type { Block, DiffRow } from '@/components/demo/model';
import { highlight, inline, type Line } from '@/components/demo/term';
import { Hanging, Lines, Spans } from '@/components/demo/term-line';

/**
 * Claude Code's transcript, block by block, as it draws them (checked
 * against v2.1 in a real terminal): tool calls as `● Name(arg)` with
 * results under `⎿`, edits as a numbered diff on tinted rows, and the
 * mascot banner at the top.
 */
const RESULT = <span className="n10-t-dim">{'  ⎿  '}</span>;

function Banner({ cwd }: { cwd: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3">
      <pre className="n10-t-claude m-0 leading-[inherit]">
        {' ▐▛███▜▌\n▝▜█████▛▘\n  ▘▘ ▝▝'}
      </pre>
      <div className="min-w-0 whitespace-nowrap">
        <div>
          <span className="n10-t-bold">Claude Code</span>{' '}
          <span className="n10-t-dim">v2.1.283</span>
        </div>
        <div className="n10-t-dim">Opus 5.5 · Claude Max</div>
        <div className="n10-t-dim truncate">{cwd}</div>
      </div>
    </div>
  );
}

function Prompt({ lines }: { lines: readonly string[] }) {
  return (
    <Hanging lead="❯ " className="n10-t-user">
      <Lines lines={lines} />
    </Hanging>
  );
}

/** `● Title` with an optional result block under `⎿`. */
function Call({
  title,
  result,
  children,
}: {
  title: ReactNode;
  result?: readonly Line[];
  children?: ReactNode;
}) {
  return (
    <div>
      <Hanging lead={<span className="n10-t-ok">● </span>}>{title}</Hanging>
      {result && (
        <Hanging lead={RESULT}>
          <Lines lines={result} />
        </Hanging>
      )}
      {children}
    </div>
  );
}

function rowClass(row: DiffRow, write: boolean): string {
  if (write || row.sign === ' ') return '';
  return row.sign === '+' ? 'n10-t-add' : row.sign === '-' ? 'n10-t-del' : '';
}

function Diff({ rows, write }: { rows: readonly DiffRow[]; write: boolean }) {
  return (
    <div className="pl-[1ch] sm:pl-[6ch]">
      {rows.map((row) => {
        const key = `${row.sign}${row.n ?? ''}${row.code ?? ''}`;
        if (row.sign === '…') {
          return (
            <div key={key} className="n10-t-dim">
              {'   ...'}
            </div>
          );
        }
        const sign = write ? ' ' : row.sign;
        const lead = `${String(row.n ?? '').padStart(4)} ${sign}`;
        return (
          <Hanging key={key} lead={lead} className={rowClass(row, write)}>
            <div className="whitespace-pre-wrap">
              <Spans spans={highlight(row.code ?? '')} />
            </div>
          </Hanging>
        );
      })}
    </div>
  );
}

function Say({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <Hanging lead="● ">
      {paragraphs.map((p, i) => {
        const listed =
          /^\d+\./.test(p) && /^\d+\./.test(paragraphs[i - 1] ?? '');
        return (
          <p key={p} className={i > 0 && !listed ? 'mt-[1lh]' : undefined}>
            <Spans spans={inline(p)} />
          </p>
        );
      })}
    </Hanging>
  );
}

function ToolTitle({ name, arg }: { name: string; arg: string }) {
  return (
    <span className="whitespace-pre-wrap">
      <span className="n10-t-bold">{name}</span>({arg})
    </span>
  );
}

export function ClaudeBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'banner':
      return <Banner cwd={block.cwd} />;
    case 'prompt':
      return <Prompt lines={block.lines} />;
    case 'tool':
      return (
        <Call
          title={<ToolTitle name={block.name} arg={block.arg} />}
          result={block.out}
        />
      );
    case 'collapsed':
      return (
        <Call
          title={
            <>
              {block.text} <span className="n10-t-dim">(ctrl+o to expand)</span>
            </>
          }
        />
      );
    case 'edit':
      return (
        <Call
          title={<ToolTitle name={block.verb} arg={block.path} />}
          result={[block.note]}
        >
          <Diff rows={block.rows} write={block.verb === 'Write'} />
        </Call>
      );
    case 'say':
      return <Say paragraphs={block.paragraphs} />;
    case 'done':
      return <div className="n10-t-dim">✻ {block.text}</div>;
    case 'interrupted':
      return (
        <Hanging lead={RESULT}>
          <span className="n10-t-err">Interrupted</span>
          <span className="n10-t-dim"> · What should Claude do instead?</span>
        </Hanging>
      );
  }
}
