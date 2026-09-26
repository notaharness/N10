import { describe, it, expect } from 'vitest';
import {
  diffScans,
  type DiscoveredTerminal,
  type DiscoveredWorktree,
  type DiscoveryScan,
} from './discovery-model.js';

function wt(name: string, branch = name): DiscoveredWorktree {
  return { name, branch, path: `/repo/.claude/worktrees/${name}` };
}

function term(
  id: string,
  kind: 'shell' | 'agent' = 'shell'
): DiscoveredTerminal {
  return { name: `n10-${kind}-${id}`, kind, path: `/dir/${id}` };
}

function scan(
  worktrees: DiscoveredWorktree[],
  persisted: string[] = [],
  terminals: DiscoveredTerminal[] = []
): DiscoveryScan {
  return { worktrees, persisted: new Set(persisted), terminals };
}

const nothingAlive = () => false;
const allAlive = () => true;

describe('diffScans', () => {
  describe('worktrees', () => {
    it('reports a worktree the previous scan did not have', () => {
      const delta = diffScans(
        scan([wt('feature-a')]),
        scan([wt('feature-a'), wt('feature-b')]),
        nothingAlive
      );
      expect(delta.appeared).toEqual([wt('feature-b')]);
      expect(delta.disappeared).toEqual([]);
      expect(delta.changed).toBe(true);
    });

    it('reports a worktree that is gone', () => {
      const delta = diffScans(
        scan([wt('feature-a'), wt('feature-b')]),
        scan([wt('feature-a')]),
        nothingAlive
      );
      expect(delta.disappeared).toEqual(['feature-b']);
      expect(delta.changed).toBe(true);
    });

    it('reports nothing when the set is unchanged', () => {
      const delta = diffScans(
        scan([wt('feature-a')]),
        scan([wt('feature-a')]),
        nothingAlive
      );
      expect(delta).toMatchObject({
        appeared: [],
        disappeared: [],
        switched: [],
        adoptable: [],
        ended: [],
        changed: false,
      });
    });

    // A worktree's name is its checkout, so one checkout removed and
    // another added reads as one row leaving and another arriving —
    // which is exactly what the sidebar should show.
    it('treats a replaced worktree as one leaving and one arriving', () => {
      const delta = diffScans(
        scan([wt('feature-a')]),
        scan([wt('feature-b')]),
        nothingAlive
      );
      expect(delta.appeared).toEqual([wt('feature-b')]);
      expect(delta.disappeared).toEqual(['feature-a']);
    });
  });

  describe('the first scan', () => {
    // Both shells list worktrees themselves at startup. Announcing the
    // initial set as "appeared" would only buy a redundant refresh.
    it('announces no worktrees', () => {
      const delta = diffScans(
        null,
        scan([wt('feature-a'), wt('feature-b')]),
        nothingAlive
      );
      expect(delta.appeared).toEqual([]);
      expect(delta.disappeared).toEqual([]);
      expect(delta.changed).toBe(false);
    });

    // …but it is what reattaches to sessions that outlived the last run,
    // which is the job repo-open restore used to do on its own.
    it('still offers sessions that survived a previous run', () => {
      const delta = diffScans(
        null,
        scan([wt('feature-a')], ['feature-a']),
        nothingAlive
      );
      expect(delta.adoptable).toEqual([wt('feature-a')]);
      expect(delta.changed).toBe(true);
    });
  });

  describe('adoptable', () => {
    it('offers a session this process holds no live PTY for', () => {
      const delta = diffScans(
        scan([wt('feature-a')]),
        scan([wt('feature-a')], ['feature-a']),
        nothingAlive
      );
      expect(delta.adoptable).toEqual([wt('feature-a')]);
    });

    // The load-bearing guarantee: an agent we are already attached to
    // must never be handed to spawnSession again.
    it('never offers a session that is already alive here', () => {
      const delta = diffScans(
        scan([wt('feature-a')], ['feature-a']),
        scan([wt('feature-a')], ['feature-a']),
        allAlive
      );
      expect(delta.adoptable).toEqual([]);
      expect(delta.changed).toBe(false);
    });

    it('does not offer a worktree with no tmux session behind it', () => {
      const delta = diffScans(
        scan([wt('feature-a')]),
        scan([wt('feature-a'), wt('feature-b')]),
        nothingAlive
      );
      expect(delta.adoptable).toEqual([]);
    });

    // Absolute state, not a diff: an attach that failed last scan is
    // simply offered again rather than being lost forever.
    it('keeps offering the same session until it is alive', () => {
      const persisted = scan([wt('feature-a')], ['feature-a']);
      expect(diffScans(persisted, persisted, nothingAlive).adoptable).toEqual([
        wt('feature-a'),
      ]);
    });
  });

  describe('ended', () => {
    it('reports a session whose tmux session went away', () => {
      const delta = diffScans(
        scan([wt('feature-a')], ['feature-a']),
        scan([wt('feature-a')]),
        allAlive
      );
      expect(delta.ended).toEqual(['feature-a']);
      expect(delta.changed).toBe(true);
    });

    it('reports a session whose worktree went away with it', () => {
      const delta = diffScans(
        scan([wt('feature-a')], ['feature-a']),
        scan([]),
        allAlive
      );
      expect(delta.ended).toEqual(['feature-a']);
      expect(delta.disappeared).toEqual(['feature-a']);
    });

    it('stays empty when neither scan reports persisted sessions', () => {
      const delta = diffScans(
        scan([wt('feature-a')]),
        scan([wt('feature-a')]),
        allAlive
      );
      expect(delta.ended).toEqual([]);
      expect(delta.changed).toBe(false);
    });
  });

  /**
   * Terminal sessions have no worktree to be "appeared" through, so
   * they are offered on absolute state alone: every live one this
   * process holds no PTY for, every scan, until it is attached.
   */
  describe('terminals', () => {
    it('offers every terminal this process is not attached to', () => {
      const delta = diffScans(
        null,
        scan([], [], [term('aa'), term('bb', 'agent')]),
        nothingAlive
      );
      expect(delta.adoptableTerminals).toEqual([
        term('aa'),
        term('bb', 'agent'),
      ]);
      expect(delta.changed).toBe(true);
    });

    it('never offers a terminal that is already alive here', () => {
      const delta = diffScans(
        scan([], [], [term('aa')]),
        scan([], [], [term('aa')]),
        allAlive
      );
      expect(delta.adoptableTerminals).toEqual([]);
      expect(delta.changed).toBe(false);
    });

    it('does not repeatedly adopt an exited terminal already held for viewing', () => {
      const stopped = { ...term('done', 'agent'), running: false };
      const current = scan([], [], [stopped]);
      const delta = diffScans(
        current,
        current,
        nothingAlive,
        new Set(),
        allAlive
      );
      expect(delta.adoptableTerminals).toEqual([]);
      expect(delta.changed).toBe(false);
    });

    it('leaves out a terminal the scanner has retired', () => {
      const delta = diffScans(
        null,
        scan([], [], [term('aa'), term('bb')]),
        nothingAlive,
        new Set([term('aa').name])
      );
      expect(delta.adoptableTerminals).toEqual([term('bb')]);
    });

    it('reports a terminal whose tmux session went away', () => {
      const delta = diffScans(
        scan([], [], [term('aa')]),
        scan([], [], []),
        allAlive
      );
      expect(delta.endedTerminals).toEqual([term('aa').name]);
      expect(delta.changed).toBe(true);
    });
  });
});
