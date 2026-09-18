/**
 * A tiny hand-rolled flag parser — no argument-parsing dependency, per the
 * brief. `--` stops flag parsing; everything after it is `rest`, which is
 * how `exec`/`connect` take a literal argv without beam trying to
 * interpret it.
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

function flagName(token: string): string | null {
  return token.startsWith('--') && token.length > 2 ? token.slice(2) : null;
}

interface FlagSets {
  valueFlags: Set<string>;
  multiFlags: Set<string>;
  booleanFlags: Set<string>;
}

/** Consume one `--name [value]` flag at `args[i]`; returns how many tokens
 * it took. Split out of `parseArgs` purely to keep that function's
 * complexity under the workspace's budget (docs/linting.md). */
function consumeFlag(
  name: string,
  args: string[],
  i: number,
  sets: FlagSets,
  result: ParsedArgs
): number {
  if (sets.booleanFlags.has(name)) {
    result.booleans.add(name);
    return 1;
  }
  if (!sets.valueFlags.has(name) && !sets.multiFlags.has(name)) {
    throw new UsageError(`unrecognized option --${name}`);
  }
  const value = args[i + 1];
  if (value === undefined) throw new UsageError(`--${name} requires a value`);
  if (sets.multiFlags.has(name)) {
    const list = result.multi.get(name) ?? [];
    list.push(value);
    result.multi.set(name, list);
  } else {
    result.values.set(name, value);
  }
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
    const name = flagName(token);
    if (name === null) {
      result.positionals.push(token);
      i += 1;
      continue;
    }
    i += consumeFlag(name, args, i, sets, result);
  }
  return result;
}
