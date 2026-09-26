import { BEAM_REPO } from './beam.js';
import { HOME, sessionKey, type RepoData } from './identity.js';
import { N10_REPO } from './n10.js';

/**
 * Every repository the demo knows. n10 and beam are recent when the
 * page loads; the Orchestra plugins checkout is what the folder picker
 * offers, so adding a repository adds it.
 */
const PLUGINS = `${HOME}/code/plugins`;

const PLUGINS_REPO: RepoData = {
  cwd: PLUGINS,
  slug: 'notaharness/plugins',
  defaultBranch: 'main',
  branches: ['main', 'docs/orchestra-terminal-style'],
  worktrees: ['docs/orchestra-terminal-style'],
  sidebar: () => [
    {
      kind: 'session',
      session: {
        name: sessionKey(PLUGINS, 'docs/orchestra-terminal-style'),
        running: false,
      },
      branch: 'docs/orchestra-terminal-style',
      isMerged: false,
    },
  ],
  diffs: {},
  descriptions: {},
};

export const REPOS: readonly RepoData[] = [N10_REPO, BEAM_REPO, PLUGINS_REPO];

/** Recent when the page loads. */
export const RECENT: readonly string[] = [N10_REPO.cwd, BEAM_REPO.cwd];
