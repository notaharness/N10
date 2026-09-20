import type { AppConfig } from '@n10/vcs-core';
import { getSession, type NamedPtyEntry } from '../pty-registry.js';
import type { SessionIncarnation } from './session-launch-context.js';
import { openSession } from './open-session.js';
import type { MachineEnvRequest } from './machine-env.js';
import { worktreeRequest } from './session-request.js';
import { noteInput } from '../activity.js';
import {
  resolveAgent,
  isKnownAgentId,
  type AgentDefinition,
  type LaunchSpec,
  type SeedOptions,
} from '../agents/registry.js';

// ── Session launcher ─────────────────────────────────────────────
//
// The single place that turns a high-level intent ("start a blank
// session", "seed a review", "resume or seed") plus the configured
// agent into a concrete PTY spawn. Every spawn call site routes through
// here so they all honor `config.agentId` and never hardcode `claude`
// or hand-build shell strings.

export type LaunchIntent =
  | 'blank'
  | 'continue-or-blank'
  | 'seed'
  | 'continue-or-seed';

export interface LaunchRequest {
  intent: LaunchIntent;
  /** Required for `seed` / `continue-or-seed`. */
  prompt?: string;
  /**
   * Optional guidance (e.g. "here's how to use n10's add-comment
   * command"). Delivered as a native system prompt for agents that
   * support it (Claude), folded into the prompt for the rest.
   */
  systemGuidance?: string;
}

function foldGuidance(
  agent: AgentDefinition,
  prompt: string,
  req: Pick<LaunchRequest, 'systemGuidance'>
): { prompt: string; opts: SeedOptions | undefined } {
  const guidance = req.systemGuidance;
  if (!guidance) return { prompt, opts: undefined };
  if (agent.supportsAppendSystemPrompt) {
    return { prompt, opts: { appendSystemPrompt: guidance } };
  }
  return { prompt: `${guidance}\n\n${prompt}`, opts: undefined };
}

/**
 * Build the concrete {@link LaunchSpec} for an agent + request. Pure —
 * no spawning — so it's unit-testable. Degrades safely when the agent
 * lacks a capability (continue → blank/seed, seed → blank).
 */
/**
 * The two intents that carry a prompt. Both fold the guidance in the
 * same way and then walk the same capability ladder down to `blank()`.
 */
function buildSeedSpec(agent: AgentDefinition, req: LaunchRequest): LaunchSpec {
  const { prompt, opts } = foldGuidance(agent, req.prompt ?? '', req);
  if (req.intent === 'continue-or-seed') {
    const continued = agent.continueOrSeed?.(prompt, opts);
    if (continued) return continued;
  }
  return agent.seed?.(prompt, opts) ?? agent.blank();
}

export function buildLaunchSpec(
  agent: AgentDefinition,
  req: LaunchRequest
): LaunchSpec {
  switch (req.intent) {
    case 'blank':
      return agent.blank();
    case 'continue-or-blank':
      return agent.continueOrBlank?.() ?? agent.blank();
    case 'seed':
    case 'continue-or-seed':
      return buildSeedSpec(agent, req);
  }
}

export interface LaunchSessionParams {
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  config: AppConfig;
  request: LaunchRequest;
  /**
   * Launch this agent instead of the one `config` resolves to. The
   * session menu's per-launch picker passes it; every other caller
   * leaves it unset and gets the configured default.
   */
  agent?: AgentDefinition;
  /** What the session wants from the machine it runs on — see
   *  `machine-env.ts`. Carried as tokens, resolved at launch. */
  machine?: MachineEnvRequest;
  /** Discovery only attaches; a user launch may restart an exited agent. */
  mode?: 'open' | 'attach';
  fresh?: boolean;
  expected?: SessionIncarnation;
}

/**
 * Resolve the agent (an explicit override, else the configured one),
 * build its launch spec for the request, and spawn the PTY. Returns
 * the created entry.
 */
export function launchSession(
  params: LaunchSessionParams
): Promise<NamedPtyEntry> {
  return openSession({
    session: worktreeRequest(params.name),
    mode: params.mode,
    fresh: params.fresh,
    intent: params.request.intent.startsWith('continue') ? 'continue' : 'fresh',
    expected: params.expected,
    machine: params.machine,
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    build: (previous, restarting) =>
      buildAgentLaunch(params, previous, restarting),
  });
}

/**
 * Deliver a prompt to an already-running session by typing it into the
 * REPL (non-destructive). The trailing carriage return submits it.
 * Returns false if the session isn't alive.
 */
export function deliverToRunningSession(name: string, prompt: string): boolean {
  const entry = getSession(name);
  if (
    !entry ||
    entry.exited ||
    (entry.pty.connectionState && entry.pty.connectionState !== 'connected')
  )
    return false;
  // The terminal echoes what is typed; that is not the agent working.
  noteInput(name);
  entry.pty.write(prompt + '\r');
  return true;
}

/** Recorded metadata wins over the default when restarting a retained agent. */
export function buildAgentLaunch(
  params: Pick<LaunchSessionParams, 'config' | 'agent' | 'request'>,
  previous?: string,
  restarting = false
): { spec: LaunchSpec; agent: string; fresh?: boolean } {
  const continuing = params.request.intent.startsWith('continue');
  if (
    restarting &&
    continuing &&
    !params.agent &&
    !knownRecordedAgent(previous, params.config.aiCommand)
  ) {
    throw new Error(
      'This session has no known agent metadata. Choose an agent explicitly to restart it.'
    );
  }
  const agent =
    params.agent ??
    resolveAgent(
      continuing && previous
        ? { ...params.config, agentId: previous as AppConfig['agentId'] }
        : params.config
    );
  if (restarting && continuing) {
    return { spec: buildResumeSpec(agent, params.request), agent: agent.id };
  }
  return {
    spec: buildLaunchSpec(agent, params.request),
    agent: agent.id,
    ...(!continuing ? { fresh: true } : {}),
  };
}

/**
 * Whether `agent` (the tag recorded on the session, e.g.
 * `@orchestra-agent`) can be restarted without asking the user to pick
 * explicitly. `test` only counts when the config still carries the
 * `aiCommand` that agent runs verbatim — otherwise a continuation would
 * resume as `sh -c ''`, or silently redirect to whatever `aiCommand`
 * happens to be set to now.
 */
function knownRecordedAgent(
  agent: string | undefined,
  aiCommand: string | undefined
): boolean {
  return (
    (agent === 'test' && !!aiCommand) ||
    (agent !== undefined && isKnownAgentId(agent))
  );
}

function buildResumeSpec(
  agent: AgentDefinition,
  request: LaunchRequest
): LaunchSpec {
  if (!agent.resume)
    throw new Error(
      `${agent.name} does not support automatic resume. Start a new session explicitly.`
    );
  const { prompt, opts } = foldGuidance(agent, request.prompt ?? '', request);
  return agent.resume(prompt || undefined, opts);
}
