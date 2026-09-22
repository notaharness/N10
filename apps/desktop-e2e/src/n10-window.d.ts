/**
 * Minimal view of the renderer's `window.n10` bridge for
 * `page.evaluate` calls.
 *
 * Deliberately not the real `N10HostApi`: an e2e suite importing the
 * app's source would couple the two projects, and these tests drive
 * the UI rather than the API. Only the handful of methods used to set
 * up or assert on host state are declared. Whether the bridge and the
 * contract still agree is the contract unit test's job, not this file's.
 */
interface N10Bridge {
  getVersion(): Promise<{
    app: string;
    electron: string;
    node: string;
    chrome: string;
  }>;
  listSessions(): Promise<
    { name: string; running: boolean; spawnedAt: number }[]
  >;
  listWorktrees(): Promise<{ branch: string; path: string; state?: string }[]>;
  getSessionActivity(): Promise<
    Record<string, { active: boolean; flashing: boolean }>
  >;
  getSettingsView(): Promise<
    {
      label: string;
      key: string;
      value: string;
      masked?: boolean;
      group: string;
      kind: 'boolean' | 'select' | 'text';
      disabled?: string;
    }[]
  >;
  updateSettingsField(
    ref: { label: string; key: string },
    value: string
  ): Promise<void>;
  getSyncState(): Promise<{
    remoteError: string | null;
    remoteSyncing: boolean;
    remoteIntervalMs: number;
    remoteFetches: number;
  }>;
  openRepo(cwd: string): Promise<{ cwd: string }>;
  getRepo(): Promise<{ cwd: string } | null>;
  launchAgent(req: {
    branch: string;
    intent: string;
  }): Promise<{ name: string }>;
  killSession(name: string): Promise<void>;
  getSessionBuffer(name: string): Promise<{ data: string; seq: number }>;
  listRecentRepos(): Promise<{ cwd: string; valid: boolean }[]>;
  listTerminals(): Promise<
    {
      name: string;
      kind: 'shell' | 'agent';
      cwd: string;
      displayPath: string;
      repo: string | null;
      running: boolean;
      spawnedAt: number;
      /** The pull request a review session is reviewing. */
      review?: string;
    }[]
  >;
  listForeignSessions(): Promise<
    { repo: string; branch: string; sessionName: string }[]
  >;
  /** Used by the perf probes to time the host half of a tab open. */
  fetchWorktreeDiffText(branch: string, target: string): Promise<string>;
}

interface Window {
  n10: N10Bridge;
}
