import {
  createTmuxBackend,
  type TmuxSessionIncarnation,
  type TmuxLaunchPlan,
} from '@n10/terminal-tmux';
import type { SessionSpec } from '@n10/terminal';
import {
  sessionNames,
  spawnSession,
  type NamedPtyEntry,
} from '../pty-registry.js';
import {
  sessionIdentity,
  terminalSessionKey,
  worktreeSessionKey,
} from '../session-key.js';
import {
  ORCHESTRA_TAG,
  reviewSessionLabel,
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
import { machineEnvAdditions, type MachineEnvRequest } from './machine-env.js';
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
  /**
   * What this launch wants from the machine it lands on — currently a
   * Claude configuration directory. Resolved here, on the launching
   * machine, rather than handed over as a path: see `machine-env.ts`.
   */
  machine?: MachineEnvRequest;
  /** Called only when a process must start, never during attachment. */
  build: (
    previousAgent?: string,
    restarting?: boolean
  ) => { spec: LaunchSpec; agent?: string; fresh?: boolean };
}

function findSession(request: SessionRequest): TaggedSession | null {
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
  const key =
    request.type === 'worktree'
      ? worktreeSessionKey(request.branch, request.repo)
      : request.target
      ? terminalSessionKey(request.target)
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
  const backend = await createTmuxBackend(
    sessionSpec(params, launch.spec, !!fresh, launch.agent),
    plan
  );
  const key =
    session.type === 'worktree'
      ? worktreeSessionKey(session.branch, session.repo)
      : terminalSessionKey(backend.name!);
  return spawnSession(key, backend, cols, rows, launch.agent);
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
  fresh: boolean,
  agent: string | undefined
): SessionSpec {
  const additions = {
    ...launch.env,
    ...machineEnvAdditions(params.machine, agent),
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
  return createPlan(request, agentTags, retainOnExit);
}

function createPlan(
  request: SessionRequest,
  agentTags: Record<string, string>,
  retainOnExit: boolean
): TmuxLaunchPlan {
  if (request.type === 'worktree') {
    return {
      mode: 'create',
      label: worktreeSessionLabel(request.repo, request.branch),
      tags: {
        ...sessionTags(request.repo, {
          type: 'worktree',
          branch: request.branch,
        }),
        ...agentTags,
      },
      retainOnExit,
    };
  }
  return {
    mode: 'create',
    label: terminalLabel(request),
    tags: {
      ...sessionTags(request.repo, {
        type: request.kind,
        ...(request.branch ? { branch: request.branch } : {}),
        ...(request.review ? { review: request.review } : {}),
      }),
      ...agentTags,
    },
    retainOnExit,
    excludedNames: sessionNames().flatMap((key) => {
      const identity = sessionIdentity(key);
      return identity?.kind === 'terminal' ? [identity.id] : [];
    }),
  };
}

/** A review says what it is in `tmux ls`; every other terminal is named
 *  for its kind. Labels only — the tags decide identity either way. */
function terminalLabel(
  request: Extract<SessionRequest, { type: 'terminal' }>
): string {
  return request.review && request.branch
    ? reviewSessionLabel(request.repo, request.branch)
    : terminalSessionLabel(request.repo, request.kind);
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
