import type {
  LaunchStepEvent,
  N10HostApi,
  SidebarItem,
  TerminalLaunchRequest,
  TerminalSummary,
} from '../../../host/contract.js';
import { HOME, sessionKey } from '../data/identity.js';
import { PROGRAMS } from '../programs/index.js';
import { Channel, later } from './hub.js';
import type { DemoSession, Program, SessionHub } from './sessions.js';
import type { DemoState, RepoState } from './state.js';

/**
 * Agent sessions and terminal tabs. Each runs one of the scripted
 * programs; launching, reviewing and checking out a plan start or feed
 * them, and the open repository's sidebar follows. Sessions in other
 * repositories are listed as foreign, which is what gives them tabs in
 * their own group on the strip.
 */
type SessionHost = Pick<
  N10HostApi,
  | 'launchAgent'
  | 'launchReviewAgent'
  | 'listAgentOptions'
  | 'getSessionLaunchContext'
  | 'checkoutPlan'
  | 'listSessions'
  | 'listForeignSessions'
  | 'getSessionActivity'
  | 'markSessionSeen'
  | 'getSessionBuffer'
  | 'writeSession'
  | 'resizeSession'
  | 'killSession'
  | 'reconnectSession'
  | 'saveClipboardImage'
  | 'launchTerminal'
  | 'listTerminals'
  | 'killTerminal'
  | 'onSessionData'
  | 'onSessionExit'
  | 'onLaunchStep'
>;

const AGENTS = [
  { id: 'claude' as const, name: 'Claude Code (default)' },
  { id: 'codex' as const, name: 'Codex' },
  { id: 'gemini' as const, name: 'Gemini CLI' },
  { id: 'copilot' as const, name: 'GitHub Copilot' },
  { id: 'opencode' as const, name: 'OpenCode' },
];

/** The branch's row now has a live agent under `name`. */
function markRunning(repo: RepoState, branch: string, name: string): void {
  repo.updateItem(
    (item) =>
      (item.kind === 'session' ? item.branch : item.pr.sourceBranch) === branch,
    (item): SidebarItem =>
      item.kind === 'session'
        ? { ...item, session: { ...item.session, name, running: true } }
        : { ...item, running: true, sessionName: name }
  );
}

function terminalSummary(state: DemoState, s: DemoSession): TerminalSummary {
  const { cwd, kind } = s.meta.terminal as {
    cwd: string;
    kind: 'shell' | 'agent';
  };
  return {
    name: s.name,
    tmuxName: (JSON.parse(s.name) as string[])[1],
    kind,
    cwd,
    displayPath: cwd.replace(HOME, '~'),
    repo: state.repos.has(cwd) ? cwd : null,
    running: s.running,
    spawnedAt: s.spawnedAt,
    machine: s.meta.machine,
  };
}

/** A new terminal tab, or a retained one restarted in place. */
function openTerminal(
  state: DemoState,
  hub: SessionHub,
  req: TerminalLaunchRequest
): DemoSession {
  const base = `${req.cwd.split('/').pop() || 'home'}-${req.kind}`;
  const taken = (id: string) => hub.get(JSON.stringify(['terminal', id]));
  let id = base;
  for (let n = 2; !req.sessionName && taken(id); n++) id = `${base}-${n}`;
  const name = req.sessionName ?? JSON.stringify(['terminal', id]);
  const repo = state.repos.get(req.cwd);
  const program =
    req.kind === 'shell'
      ? PROGRAMS.shell(req.cwd, repo?.data.defaultBranch)
      : PROGRAMS.terminalAgent(req.cwd);
  return hub.spawn(
    name,
    program,
    {
      repo: repo ? req.cwd : null,
      machine: req.machine ?? 'local',
      terminal: { kind: req.kind, cwd: req.cwd },
    },
    req
  );
}

export function createSessionHost(
  state: DemoState,
  hub: SessionHub
): SessionHost {
  const steps = new Channel<LaunchStepEvent>();
  const agents = () => hub.all().filter((s) => !s.meta.terminal);
  const inRepo = (repo: string, branch: string) =>
    agents().find((s) => s.meta.repo === repo && s.meta.branch === branch);

  /** A remote launch reports its steps, as beam's does. */
  const announce = (req: { machine?: string; launchId?: string }) => {
    const { launchId } = req;
    if (!req.machine || req.machine === 'local' || !launchId) return;
    steps.emit({ launchId, step: 'worktree' });
    setTimeout(() => steps.emit({ launchId, step: 'start' }), 500);
  };

  const start = (
    req: { machine?: string; launchId?: string; cols?: number; rows?: number },
    branch: string,
    program: Program
  ) => {
    announce(req);
    const repo = state.repo();
    const machine = req.machine ?? 'local';
    const name = sessionKey(repo.cwd, branch, machine);
    repo.worktrees.add(branch);
    hub.spawn(name, program, { repo: repo.cwd, branch, machine }, req);
    markRunning(repo, branch, name);
    return later({ name }, machine === 'local' ? 300 : 1100);
  };

  return {
    launchAgent: (req) =>
      start(req, req.branch, PROGRAMS.agent(req, state.repo())),
    launchReviewAgent: (req) =>
      start(req, req.pr.sourceBranch, PROGRAMS.reviewer(req.pr, state.repo())),
    listAgentOptions: () => later(AGENTS),
    getSessionLaunchContext: (branch) => {
      const session = inRepo(state.current, branch);
      return later({
        exists: Boolean(session),
        running: session?.running ?? false,
        canResume: true,
        defaultAgentName: 'Claude Code',
        ...(session
          ? { recordedAgent: 'claude', recordedAgentName: 'Claude Code' }
          : {}),
      });
    },
    checkoutPlan: async (req) => {
      const repo = state.repo();
      const session = inRepo(repo.cwd, req.pr.sourceBranch);
      if (session?.running && req.mode === 'inject') {
        PROGRAMS.plan(session, req.pr, req.prompt, repo);
        return later('injected' as const, 300);
      }
      const program = PROGRAMS.planned(req.pr, req.prompt, repo);
      await start(req, req.pr.sourceBranch, program);
      return 'spawned' as const;
    },
    listSessions: () =>
      later(
        agents()
          .filter((s) => s.meta.repo === state.current)
          .map((s) => ({
            name: s.name,
            running: s.running,
            spawnedAt: s.spawnedAt,
            machine: s.meta.machine,
          }))
      ),
    listForeignSessions: () =>
      later(
        agents()
          .filter((s) => s.running && s.meta.repo !== state.current)
          .map((s) => ({
            repo: s.meta.repo ?? '',
            branch: s.meta.branch ?? '',
            sessionName: s.name,
          }))
      ),
    getSessionActivity: () =>
      later(Object.fromEntries(hub.all().map((s) => [s.name, s.activity()]))),
    markSessionSeen: (name) => {
      const session = hub.get(name);
      if (session) session.flashing = false;
      return later(undefined);
    },
    getSessionBuffer: (name) => {
      const session = hub.get(name);
      return later({ data: session?.output ?? '', seq: session?.seq ?? 0 }, 20);
    },
    writeSession: (name, data) => {
      hub.get(name)?.input(data);
      return Promise.resolve();
    },
    resizeSession: (name, cols, rows) => {
      hub.get(name)?.resize(cols, rows);
      return Promise.resolve();
    },
    killSession: (name) => {
      hub.get(name)?.kill();
      return later(undefined);
    },
    reconnectSession: () => later(undefined),
    saveClipboardImage: () => later('/tmp/n10-paste-1.png'),
    launchTerminal: (req) =>
      later(terminalSummary(state, openTerminal(state, hub, req))),
    listTerminals: () =>
      later(
        hub
          .all()
          .filter((s) => s.meta.terminal)
          .map((s) => terminalSummary(state, s))
      ),
    killTerminal: (name) => {
      hub.forget(name);
      return later(undefined);
    },
    onSessionData: hub.data.subscribe,
    onSessionExit: hub.exit.subscribe,
    onLaunchStep: steps.subscribe,
  };
}
