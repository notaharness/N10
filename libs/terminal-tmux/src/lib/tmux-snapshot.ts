import { runTmux } from './tmux-cli.js';
import {
  parseSessionLine,
  sessionColumns,
  type TmuxSessionInfo,
} from './tmux-state.js';

/** Identity of one native process incarnation, including the hosting server. */
export interface TmuxSessionIncarnation {
  name: string;
  sessionId: string;
  paneId: string;
  panePid: number;
  serverPid: number;
}
export interface TmuxSessionSnapshot extends TmuxSessionInfo {
  incarnation: TmuxSessionIncarnation;
}

/** Whether two incarnations name the exact same native process — every
 *  field must agree, not just the session's tmux label, which is reused
 *  after a kill (see tmux-launch.ts's free-name probe). */
export function sameTmuxIncarnation(
  a: TmuxSessionIncarnation,
  b: TmuxSessionIncarnation
): boolean {
  return (
    a.name === b.name &&
    a.sessionId === b.sessionId &&
    a.paneId === b.paneId &&
    a.panePid === b.panePid &&
    a.serverPid === b.serverPid
  );
}

/** Metadata and process identity from the same server observation. */
export function tmuxSessionSnapshot(
  name: string,
  options: readonly string[] = []
): TmuxSessionSnapshot | null {
  const result = runTmux([
    '-u',
    'display-message',
    '-p',
    '-t',
    `=${name}:`,
    [
      '#{session_id}',
      '#{pane_id}',
      '#{pane_pid}',
      '#{pid}',
      ...sessionColumns(options),
    ].join('\t'),
  ]);
  const fields = result.stdout.trimEnd().split('\t');
  const [sessionId, paneId, panePid, serverPid] = fields;
  if (
    result.exitCode ||
    !/^\$\d+$/.test(sessionId ?? '') ||
    !/^%\d+$/.test(paneId ?? '') ||
    !/^\d+$/.test(panePid ?? '') ||
    !/^\d+$/.test(serverPid ?? '')
  )
    return null;
  const info = parseSessionLine(fields.slice(4).join('\t'), options);
  return {
    ...info,
    incarnation: {
      name: info.name,
      sessionId,
      paneId,
      panePid: Number(panePid),
      serverPid: Number(serverPid),
    },
  };
}

/** tmux parses the branches of if-shell itself; these are tmux strings, not shell code. */
function quoteArgument(value: string): string {
  return (
    '"' +
    value.replace(
      /[\\"$\n\r\t]/g,
      (character) =>
        ({
          '\\': '\\\\',
          '"': '\\"',
          $: '\\$',
          '\n': '\\n',
          '\r': '\\r',
          '\t': '\\t',
        }[character]!)
    ) +
    '"'
  );
}

/** The guard and its commands execute on the server without a read/kill gap. */
export function runGuardedTmuxCommands(
  expected: TmuxSessionIncarnation,
  commands: string[][],
  expectedTags: Record<string, string> = {},
  env?: NodeJS.ProcessEnv
): void {
  if (
    !/^\$\d+$/.test(expected.sessionId) ||
    !/^%\d+$/.test(expected.paneId) ||
    !Number.isSafeInteger(expected.panePid) ||
    !Number.isSafeInteger(expected.serverPid)
  )
    throw new Error('Invalid tmux session incarnation');
  const checks = [
    `#{==:#{session_id},${expected.sessionId}}`,
    `#{==:#{pane_id},${expected.paneId}}`,
    `#{==:#{pane_pid},${expected.panePid}}`,
    `#{==:#{pid},${expected.serverPid}}`,
  ];
  for (const [key, value] of Object.entries(expectedTags)) {
    if (!/^@[A-Za-z0-9_-]+$/.test(key))
      throw new Error('Invalid tmux option guard');
    const literal = value
      .replace(/#/g, '##')
      .replace(/,/g, '#,')
      .replace(/}/g, '#}');
    checks.push(`#{==:#{${key}},${literal}}`);
  }
  const condition = checks.reduce((left, right) => `#{&&:${left},${right}}`);
  const success = 'tmux-launch-complete';
  const branch = [...commands, ['display-message', '-p', success]]
    .map((command) => command.map(quoteArgument).join(' '))
    .join(' ; ');
  const result = runTmux(
    ['if-shell', '-F', '-t', `=${expected.name}:`, condition, branch],
    [],
    env
  );
  if (result.exitCode || result.stdout.trim() !== success)
    throw new Error(
      `Session changed before replacement; reopen the launch dialog. ${result.stderr.trim()}`
    );
}
