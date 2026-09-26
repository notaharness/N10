import type { PullRequestInfo } from '@n10/vcs-core';
import type { SessionLaunchRequest } from '../../../host/contract.js';
import { BEAM, HOMEPAGE_SESSION, PR_HOMEPAGE } from '../data/beam.js';
import { HOME, displayDir, sessionKey } from '../data/identity.js';
import { SERVER } from '../data/machines.js';
import { N10, PR_FLEET, PR_TABS } from '../data/n10.js';
import type { DemoSession, SessionHub } from '../host/sessions.js';
import type { RepoState } from '../host/state.js';
import { ClaudeCode, type Beat } from './claude/claude-code.js';
import { FLEET } from './claude/script-fleet.js';
import { HOMEPAGE } from './claude/script-homepage.js';
import { reviewScript } from './claude/script-review.js';
import { tabsPlanBeats } from './claude/script-tabs.js';
import { Zsh } from './zsh.js';

/**
 * Which program runs in which session: what is alive when the page
 * loads (an agent in n10, one in beam on the rented server, and a zsh
 * tab), and what launching, reviewing and checking out a plan start.
 */
const DEMO_REPLY: Beat[] = [
  { after: 900, working: 'Thinking' },
  {
    after: 2200,
    working: null,
    blocks: [
      {
        kind: 'say',
        paragraphs: [
          "This session is part of n10's demo, so it can't act on that. In n10 itself this is a real Claude Code, in a real terminal, in the worktree's own tmux session.",
        ],
      },
    ],
  },
];

/** A plan with no script of its own: acknowledge it, answer its threads. */
function genericPlan(pr: PullRequestInfo, repo: RepoState): Beat[] {
  return [
    { after: 600, working: 'Planning', blocks: [{ kind: 'read', files: 3 }] },
    {
      after: 4000,
      working: null,
      effect: () => repo.resolveThreads(pr.id),
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            `Worked through the plan for #${pr.id} and answered each thread. (The demo skips the edits themselves.)`,
          ],
        },
        { kind: 'done', text: 'Worked for 34s' },
      ],
    },
  ];
}

const planBeats = (pr: PullRequestInfo, repo: RepoState) =>
  repo.cwd === N10 && pr.id === PR_TABS.id
    ? tabsPlanBeats(repo)
    : genericPlan(pr, repo);

export const PROGRAMS = {
  boot(hub: SessionHub): void {
    const fleet = PR_FLEET.sourceBranch;
    hub.spawn(sessionKey(N10, fleet), new ClaudeCode(FLEET), {
      repo: N10,
      branch: fleet,
      machine: 'local',
    });
    hub.spawn(HOMEPAGE_SESSION, new ClaudeCode(HOMEPAGE), {
      repo: BEAM,
      branch: PR_HOMEPAGE.sourceBranch,
      machine: SERVER,
    });
    hub.spawn(
      JSON.stringify(['terminal', 'n10-shell']),
      new Zsh(N10, 'master'),
      {
        repo: N10,
        machine: 'local',
        terminal: { kind: 'shell', cwd: N10 },
      }
    );
  },

  agent(req: SessionLaunchRequest, repo: RepoState): ClaudeCode {
    return new ClaudeCode({
      cwd: displayDir(repo.cwd, req.branch),
      beats: req.prompt
        ? [
            { after: 300, blocks: [{ kind: 'prompt', text: req.prompt }] },
            ...DEMO_REPLY,
          ]
        : [],
      reply: () => DEMO_REPLY,
    });
  },

  /** An agent tab opened on a directory rather than a worktree. */
  terminalAgent(cwd: string): ClaudeCode {
    return new ClaudeCode({
      cwd: cwd.replace(HOME, '~'),
      reply: () => DEMO_REPLY,
    });
  },

  reviewer(pr: PullRequestInfo, repo: RepoState): ClaudeCode {
    return new ClaudeCode({
      ...reviewScript(pr, repo),
      reply: () => DEMO_REPLY,
    });
  },

  /** A plan typed into a running agent. */
  plan(
    session: DemoSession,
    pr: PullRequestInfo,
    prompt: string,
    repo: RepoState
  ): void {
    if (session.program instanceof ClaudeCode) {
      session.program.say(prompt, planBeats(pr, repo));
    }
  },

  /** A plan that starts a fresh agent. */
  planned(pr: PullRequestInfo, prompt: string, repo: RepoState): ClaudeCode {
    return new ClaudeCode({
      cwd: displayDir(repo.cwd, pr.sourceBranch),
      history: [{ kind: 'prompt', text: prompt }],
      beats: planBeats(pr, repo),
      reply: () => DEMO_REPLY,
    });
  },

  shell(cwd: string, branch?: string): Zsh {
    return new Zsh(cwd, branch);
  },
};
