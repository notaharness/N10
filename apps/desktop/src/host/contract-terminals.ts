/**
 * Terminal tabs: sessions that belong to a directory rather than to a
 * worktree, so the user never has to leave n10 for a plain terminal.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

export type TerminalKind = 'shell' | 'agent';

export interface TerminalLaunchRequest {
  /** Restart this retained terminal instead of creating a tab. */
  sessionName?: string;
  /** Use the directory's configured agent for a fresh conversation. */
  fresh?: boolean;
  kind: TerminalKind;
  /** Absolute directory to open the terminal in. Any directory. */
  cwd: string;
  /** Initial PTY size — the renderer knows the pane geometry. */
  cols?: number;
  rows?: number;
}

/**
 * One terminal the host holds, as the renderer sees it.
 *
 * `repo` is where the tab belongs: the directory itself when it is a
 * repository root, `null` for any other directory — a folder outside
 * git, or a folder *inside* a checkout, which is deliberately not
 * walked up to its root. Derived at read time from the directory, so a
 * terminal restored from tmux is grouped the same way one just opened
 * is.
 */
export interface TerminalSummary {
  agent?: string;
  /** Actual tmux target, when attached through tmux. Never a registry key. */
  tmuxName?: string;
  /** Opaque core registry key; displayPath supplies the tab label. */
  name: string;
  kind: TerminalKind;
  cwd: string;
  /** `cwd` with the home directory written as `~`, for the tab. */
  displayPath: string;
  repo: string | null;
  running: boolean;
  spawnedAt: number;
}
