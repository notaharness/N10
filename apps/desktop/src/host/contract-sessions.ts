/**
 * Agent sessions as the renderer lists them: the open repository's own
 * (`SessionSummary`) and those alive in other repositories
 * (`ForeignSessionSummary`), which the tab strip gives a tab in their
 * own group without attaching to.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

export interface SessionSummary {
  name: string;
  running: boolean;
  spawnedAt: number;
  /** The machine this session runs on — `'local'` or a beam peerId
   *  (decisions.md D2, D8). The renderer resolves it to a label and
   *  shows it only when more than one machine is registered. */
  machine: string;
  /** Local client health, independent of `running`: a dropped
   *  connection must never render as the agent having exited
   *  (decisions.md D4). Absent for a local session, which has no
   *  separate transport to lose. */
  connectionState?: 'connected' | 'reconnecting' | 'failed';
}

/**
 * An agent alive in a repository other than the open one — tmux still
 * holds it, and its tab belongs in that repository's group on the
 * strip. A strip entry only: nothing is attached until its repository
 * is opened, when that repository's own discovery attaches it.
 */
export interface ForeignSessionSummary {
  /** The repository it runs in — the real path of the main checkout. */
  repo: string;
  branch: string;
  /** Its qualified core registry key (repository plus exact branch). */
  sessionName: string;
}
