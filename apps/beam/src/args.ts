/**
 * A tiny hand-rolled flag parser — no argument-parsing dependency, per the
 * brief. `--` stops flag parsing; everything after it is `rest`, which is
 * how `exec`/`connect` take a literal argv without beam trying to
 * interpret it.
 *
 * A value flag takes either the next token (`--cwd /srv`) or an inline
 * `--cwd=/srv`. It never takes a token that is itself a flag or the `--`
 * separator: scripts and agents drive this CLI programmatically, so a
 * mistyped `beam exec box --cwd --env FOO=bar -- ls` has to fail loudly
 * rather than run somewhere else with the env var silently dropped.
 * `--name=value` is the escape hatch for a value that really does begin
 * with `--`.
 */

import { UsageError } from './usage.js';

export interface ArgSpec {
  /** Flags that take one value; the last occurrence wins. */
  valueFlags?: string[];
  /** Flags that take one value and may repeat; values accumulate in order. */
  multiFlags?: string[];
  /** Flags that take no value. */
  booleanFlags?: string[];
}

export interface ParsedArgs {
  positionals: string[];
  values: Map<string, string>;
  multi: Map<string, string[]>;
  booleans: Set<string>;
  /** Everything after a literal `--`, unparsed. */
  rest: string[];
}

/** One `--name` or `--name=value` token, split at its *first* `=` so a
 * value that contains more of them (`--env=KEY=a=b`) survives intact. */
interface FlagToken {
  name: string;
  inlineValue?: string;
}

function flagToken(token: string): FlagToken | null {
  if (!token.startsWith('--') || token.length === 2) return null;
  const body = token.slice(2);
  const eq = body.indexOf('=');
  if (eq < 0) return { name: body };
  if (eq === 0) return null; // `--=x` names no flag; treat it as a positional.
  return { name: body.slice(0, eq), inlineValue: body.slice(eq + 1) };
}

interface FlagSets {
  valueFlags: Set<string>;
  multiFlags: Set<string>;
  booleanFlags: Set<string>;
}

/** The separate-token form of a value flag. Refuses the next token when it
 * is another flag or the `--` separator: taking it would mean running with
 * a value nobody typed and dropping whatever followed. */
function takeSeparateValue(name: string, next: string | undefined): string {
  if (next === undefined) throw new UsageError(`--${name} requires a value`);
  if (!next.startsWith('--')) return next;
  const found = next === '--' ? 'the -- argv separator' : `the flag ${next}`;
  throw new UsageError(
    `--${name} requires a value, but the next argument is ${found} — ` +
      `write --${name}=VALUE if the value itself starts with "--"`
  );
}

function recordValue(
  name: string,
  value: string,
  sets: FlagSets,
  result: ParsedArgs
): void {
  if (sets.multiFlags.has(name)) {
    const list = result.multi.get(name) ?? [];
    list.push(value);
    result.multi.set(name, list);
    return;
  }
  result.values.set(name, value);
}

/** Consume one flag at `args[i]`; returns how many tokens it took. Split
 * out of `parseArgs` purely to keep that function's complexity under the
 * workspace's budget (docs/linting.md). */
function consumeFlag(
  flag: FlagToken,
  args: string[],
  i: number,
  sets: FlagSets,
  result: ParsedArgs
): number {
  const { name, inlineValue } = flag;
  if (sets.booleanFlags.has(name)) {
    if (inlineValue !== undefined) {
      throw new UsageError(`--${name} takes no value`);
    }
    result.booleans.add(name);
    return 1;
  }
  if (!sets.valueFlags.has(name) && !sets.multiFlags.has(name)) {
    throw new UsageError(`unrecognized option --${name}`);
  }
  if (inlineValue !== undefined) {
    recordValue(name, inlineValue, sets, result);
    return 1;
  }
  recordValue(name, takeSeparateValue(name, args[i + 1]), sets, result);
  return 2;
}

export function parseArgs(args: string[], spec: ArgSpec = {}): ParsedArgs {
  const sets: FlagSets = {
    valueFlags: new Set(spec.valueFlags ?? []),
    multiFlags: new Set(spec.multiFlags ?? []),
    booleanFlags: new Set(spec.booleanFlags ?? []),
  };
  const result: ParsedArgs = {
    positionals: [],
    values: new Map(),
    multi: new Map(),
    booleans: new Set(),
    rest: [],
  };

  let i = 0;
  while (i < args.length) {
    const token = args[i] as string;
    if (token === '--') {
      result.rest = args.slice(i + 1);
      break;
    }
    const flag = flagToken(token);
    if (flag === null) {
      result.positionals.push(token);
      i += 1;
      continue;
    }
    i += consumeFlag(flag, args, i, sets, result);
  }
  return result;
}
