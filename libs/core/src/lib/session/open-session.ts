import {
  createRemoteTmuxBackend,
  createTmuxBackend,
  type TmuxSessionIncarnation,
  type TmuxLaunchPlan,
} from '@n10/terminal-tmux';
import type { SessionBackend, SessionSpec } from '@n10/terminal';
import {
  sessionNames,
  spawnSession,
  type NamedPtyEntry,
} from '../pty-registry.js';
import {
  LOCAL_MACHINE,
  sessionIdentity,
  terminalSessionKey,
  worktreeSessionKey,
} from '../session-key.js';
import { pollerFor, requireMachine } from '../machine-registry.js';
import {
  ORCHESTRA_TAG,
  sessionTags,
  terminalSessionLabel,
  worktreeSessionLabel,
  type TaggedSession,
} from '../session-identity.js';
import {
  resolveSessionByName,
  resolveWorktreeSession,
} from '../session-resolver.js';
import { readWorktreeHead } from '../discovery/worktree-origin.js';
import type { LaunchSpec } from '../agents/registry.js';
import type { SessionRequest } from './session-request.js';

export interface OpenSessionParams {
  session: SessionRequest;
  mode?: 'open' | 'create' | 'attach';
  fresh?: boolean;
  intent?: 'fresh' | 'continue';
  expected?: TmuxSessionIncarnation;
  cwd: string;
  cols: number;
  rows: number;
  /** Called only when a process must start, never during attachment. */
  build: (
    previousAgent?: string,
    restarting?: boolean
  ) => { spec: LaunchSpec; agent?: string; fresh?: boolean };
}

function findSession(request: SessionRequest): TaggedSession | null {
  // Remote session discovery is not built this phase (D3's poller
  // starts once a backend exists; nothing resolves an *existing*
  // remote session by identity yet). A remote request therefore always
  // creates fresh — see `launchPlan`'s `!existing` branch — rather than
  // querying local tmux for a session that could never live there.
  if ((request.machine ?? LOCAL_MACHINE) !== LOCAL_MACHINE) return null;
  return request.type === 'worktree'
    ? resolveWorktreeSession(request.repo, request.branch)
    : request.target
    ? resolveSessionByName(request.target)
    : null;
}

function validateCheckout(request: SessionRequest, cwd: string): void {
  if (request.type !== 'worktree') return;
  const head = readWorktreeHead(cwd);
  if (head && !head.detached && head.branch !== request.branch) {
    throw new Error(`Worktree is on "${head.branch}", not "${request.branch}"`);
  }
}

/** Resolve before building argv: attaching never consults the current agent default. */
const opening = new Map<
  string,
  { promise: Promise<NamedPtyEntry>; fresh: boolean; signature: string }
>();

export function openSession(params: OpenSessionParams): Promise<NamedPtyEntry> {
  const request = params.session;
  const machineId = request.machine ?? LOCAL_MACHINE;
  const key =
    request.type === 'worktree'
      ? worktreeSessionKey(request.branch, request.repo, machineId)
      : request.target
      ? terminalSessionKey(request.target, machineId)
      : undefined;
  if (!key) return performOpen(params);
  const fresh = !!params.fresh || params.intent === 'fresh';
  const signature = JSON.stringify({
    mode: params.mode ?? 'open',
    expected: params.expected,
  });
  const pending = opening.get(key);
  if (pending) {
    // Only non-destructive opens may coalesce. Never lose a fresh/replacement
    // request behind an unrelated attach or another fresh conversation.
    if (pending.fresh || fresh || pending.signature !== signature)
      return Promise.reject(
        new Error(
          'Another launch is in progress for this session. Try again when it finishes.'
        )
      );
    return pending.promise;
  }
  const operation = performOpen(params).finally(() => opening.delete(key));
  opening.set(key, { promise: operation, fresh, signature });
  return operation;
}

async function performOpen(params: OpenSessionParams): Promise<NamedPtyEntry> {
  const { session, cols, rows, mode = 'open' } = params;
  const existing = resolveOpenTarget(params);
  const attaching = !params.fresh && shouldAttach(mode, existing);
  const launch = attaching
    ? { spec: { cmd: '', args: [] }, agent: existing!.agent, fresh: false }
    : params.build(existing?.agent, !!existing);
  const fresh = !attaching && (params.fresh || launch.fresh);
  const plan: TmuxLaunchPlan = attaching
    ? {
        mode: 'attach',
        target: existing!.name,
        ...(params.expected
          ? {
              expected: params.expected,
              expectedTags: identityGuard(existing!),
            }
          : {}),
      }
    : launchPlan(session, existing, launch.agent, fresh, params.expected);
  const machineId = session.machine ?? LOCAL_MACHINE;
  const spec = sessionSpec(params, launch.spec, !!fresh);
  const backend: SessionBackend =
    machineId === LOCAL_MACHINE
      ? await createTmuxBackend(spec, plan)
      : await createRemoteBackend(spec, plan, machineId);
  const key =
    session.type === 'worktree'
      ? worktreeSessionKey(session.branch, session.repo, machineId)
      : terminalSessionKey(backend.name!, machineId);
  return spawnSession(key, backend, cols, rows, launch.agent);
}

/** The remote twin of `createTmuxBackend`: the same plan, executed on
 *  `machineId` (decisions.md D5). `requireMachine` throws loudly
 *  (rather than falling back to a local launch) when the machine is
 *  not available — "the one thing that must not happen". */
function createRemoteBackend(
  spec: SessionSpec,
  plan: TmuxLaunchPlan,
  machineId: string
): Promise<SessionBackend> {
  const machine = requireMachine(machineId);
  return createRemoteTmuxBackend(spec, plan, machine, pollerFor(machine));
}

function resolveOpenTarget(params: OpenSessionParams): TaggedSession | null {
  const { session, cwd, mode = 'open' } = params;
  validateCheckout(session, cwd);
  const existing = mode === 'create' ? null : findSession(session);
  if (mode === 'attach' && !existing)
    throw new Error('Session ended before it could be attached');
  if (params.expected && (!existing || params.expected.name !== existing.name))
    throw new Error(
      'Session changed before replacement; reopen the launch dialog.'
    );
  if (params.fresh && existing && !existing.paneDead && !params.expected)
    throw new Error(
      'Replacing a running session requires confirmation of its current incarnation.'
    );
  return existing;
}

function sessionSpec(
  params: OpenSessionParams,
  launch: LaunchSpec,
  fresh: boolean
): SessionSpec {
  const additions = {
    ...launch.env,
    ...(fresh ? { ORCHESTRA_SESSION: '', ORCHESTRA_SOCKET: '' } : {}),
  };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...additions,
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  return {
    ...launch,
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    env,
    envAdditions: additions,
  };
}

function launchPlan(
  request: SessionRequest,
  existing: TaggedSession | null,
  agent?: string,
  fresh = false,
  expected?: TmuxSessionIncarnation
): TmuxLaunchPlan {
  const identity =
    request.type === 'worktree'
      ? { type: 'worktree' as const, branch: request.branch }
      : { type: request.kind };
  const agentTags: Record<string, string> = agent
    ? { [ORCHESTRA_TAG.agent]: agent }
    : {};
  const retainOnExit = request.type === 'worktree' || request.kind === 'agent';
  if (existing) {
    const tags = {
      ...agentTags,
      ...(fresh
        ? {
            [ORCHESTRA_TAG.orchestrator]: null,
            [ORCHESTRA_TAG.lastReport]: null,
          }
        : {}),
    };
    if (fresh && expected)
      return {
        mode: 'replace',
        target: existing.name,
        expected,
        retainOnExit,
        tags,
        expectedTags: identityGuard(existing),
      };
    // Unconfirmed restarts never use -k. An external live winner is left alone.
    return {
      mode: 'restart',
      target: existing.name,
      tags,
      retainOnExit,
      ...(expected ? { expected, expectedTags: identityGuard(existing) } : {}),
    };
  }
  return {
    mode: 'create',
    label:
      request.type === 'worktree'
        ? worktreeSessionLabel(request.repo, request.branch)
        : terminalSessionLabel(request.repo, request.kind),
    tags: { ...sessionTags(request.repo, identity), ...agentTags },
    retainOnExit,
    excludedNames:
      request.type === 'terminal'
        ? sessionNames().flatMap((key) => {
            const identity = sessionIdentity(key);
            return identity?.kind === 'terminal' ? [identity.id] : [];
          })
        : undefined,
  };
}

function shouldAttach(mode: string, session: TaggedSession | null): boolean {
  return session !== null && (mode === 'attach' || !session.paneDead);
}

function identityGuard(session: TaggedSession): Record<string, string> {
  return {
    [ORCHESTRA_TAG.repo]: session.repo,
    [ORCHESTRA_TAG.sessionType]: session.type,
    [ORCHESTRA_TAG.branch]: session.branch,
    [ORCHESTRA_TAG.spawner]: session.spawner,
  };
}
