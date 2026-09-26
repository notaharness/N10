import type { PullRequestInfo } from '@n10/vcs-core';
import type {
  PullRequestComments,
  ReviewComment,
  SidebarItem,
} from '../../../host/contract.js';
import type { RepoData } from '../data/identity.js';
import { RECENT, REPOS } from '../data/repos.js';
import { Channel } from './hub.js';

/**
 * Everything the demo's "remote" and "disk" hold, in memory, one
 * `RepoState` per repository. The host answers for whichever is open,
 * as the real one does; scripts change their own repository's state
 * whether or not it is open. The renderer notices the way it does
 * against a real host, by polling and through the channels here.
 */
export interface Channels {
  readonly remoteUpdated: Channel<void>;
  readonly discovery: Channel<void>;
}

export class RepoState {
  sidebar: SidebarItem[];
  threads: Record<number, PullRequestComments>;
  drafts: Record<number, ReviewComment[]> = {};
  readonly worktrees: Set<string>;

  constructor(readonly data: RepoData, private readonly channels: Channels) {
    this.sidebar = data.sidebar();
    this.threads = data.threads?.() ?? {};
    this.worktrees = new Set(data.worktrees);
  }

  get cwd(): string {
    return this.data.cwd;
  }

  pullRequests(): PullRequestInfo[] {
    return this.sidebar.flatMap((item) => (item.pr ? [item.pr] : []));
  }

  pr(id: number): PullRequestInfo | undefined {
    return this.pullRequests().find((pr) => pr.id === id);
  }

  /** Change a pull request wherever the sidebar carries it. */
  updatePr(id: number, patch: Partial<PullRequestInfo>): void {
    this.sidebar = this.sidebar.map((item) =>
      item.pr?.id === id ? { ...item, pr: { ...item.pr, ...patch } } : item
    );
    this.channels.remoteUpdated.emit();
  }

  updateItem(
    match: (item: SidebarItem) => boolean,
    change: (item: SidebarItem) => SidebarItem
  ): void {
    this.sidebar = this.sidebar.map((item) =>
      match(item) ? change(item) : item
    );
    this.channels.discovery.emit();
  }

  threadsOf(prId: number): PullRequestComments {
    return this.threads[prId] ?? { threads: [], generalComments: [] };
  }

  /** Resolve every review thread, as an agent answering them would. */
  resolveThreads(prId: number): void {
    const current = this.threadsOf(prId);
    this.threads[prId] = {
      ...current,
      threads: current.threads.map((t) => ({ ...t, isResolved: true })),
    };
    this.recount(prId);
  }

  /** Re-count a pull request's open threads, as the provider would. */
  recount(prId: number): void {
    const open = this.threadsOf(prId).threads.filter((t) => !t.isResolved);
    this.updatePr(prId, { activeCommentCount: open.length });
  }
}

export class DemoState implements Channels {
  readonly remoteUpdated = new Channel<void>();
  readonly discovery = new Channel<void>();
  readonly repos = new Map<string, RepoState>(
    REPOS.map((data) => [data.cwd, new RepoState(data, this)])
  );
  readonly recent: string[] = [...RECENT];
  current: string = RECENT[0] as string;

  /** The open repository. */
  repo(): RepoState {
    return this.repos.get(this.current) as RepoState;
  }

  /** Open a repository the demo knows; anything else is not one. */
  open(cwd: string): RepoState {
    const repo = this.repos.get(cwd);
    if (!repo) throw new Error(`${cwd} is not a git repository`);
    this.current = cwd;
    if (!this.recent.includes(cwd)) this.recent.unshift(cwd);
    return repo;
  }
}
