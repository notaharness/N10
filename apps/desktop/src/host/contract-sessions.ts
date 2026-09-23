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
