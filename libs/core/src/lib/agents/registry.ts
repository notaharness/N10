import type { AgentId, AppConfig } from '@n10/vcs-core';

// ── Agent capability registry ────────────────────────────────────
//
// A single, capability-aware description of every AI agent n10 can
// drive. Each definition knows how to build the argv for the ways we
// launch it — blank, seed-with-a-prompt, or continue-a-prior-session —
// so callers never hand-compose shell strings (which is how prompt
// quote-stripping and the hardcoded-`claude` review bug crept in).
//
// Prompts are always passed as a single argv element (or via an env
// var for the shell-composed `continue || …` paths), never interpolated
// into a command string. That removes both the quoting corruption and
// the shell-injection surface.
//
// Capability notes (verified against each CLI's docs, erring cautious):
//   • Only Claude supports appending a system prompt (`--append-system-prompt`).
//     For every other agent, guidance is folded into the user prompt by the
//     launcher instead.
//   • Retained Claude and Codex agents have explicit resume adapters. Other
//     agents reject automatic resume rather than silently starting over.
//   • New launches may use the existing continue-or-fresh capability;
//     attaching a tmux session never invokes an agent adapter.

/** Extends the public {@link AgentId} with the internal, UI-hidden test runner. */
export type ResolvedAgentId = AgentId | 'test';

export interface LaunchSpec {
  cmd: string;
  args: string[];
  /**
   * Extra environment variables. Merged over `process.env` by
   * `spawnSession` (never replaces it). Used to deliver a seed prompt to
   * the shell-composed `continue || seed` path without ever placing the
   * prompt text in the command string.
   */
  env?: Record<string, string | undefined>;
}

export interface SeedOptions {
  /**
   * Guidance to install as a system prompt. Honored natively only by
   * agents with {@link AgentDefinition.supportsAppendSystemPrompt}; for
   * the rest the launcher folds it into the prompt before calling
   * `seed`, so implementations that don't support it can ignore this.
   */
  appendSystemPrompt?: string;
}

export interface AgentDefinition {
  id: ResolvedAgentId;
  /** Display name shown in settings. */
  name: string;
  /** Excluded from the settings picker (`AI_PRESETS`). The test runner. */
  hidden?: boolean;
  /** Whether the CLI can take a system prompt natively (Claude only). */
  supportsAppendSystemPrompt: boolean;
  /** Start a blank interactive session. */
  blank(): LaunchSpec;
  /** Resume an exited agent without silently starting a new conversation. */
  resume?(prompt?: string, opts?: SeedOptions): LaunchSpec;
  /**
   * Start a fresh interactive session pre-seeded with a prompt.
   * `undefined` ⇒ the agent cannot seed an interactive session; the
   * launcher falls back to {@link blank}.
   */
  seed?(prompt: string, opts?: SeedOptions): LaunchSpec;
  /**
   * Resume a prior conversation in the CWD, falling back to a blank
   * session. `undefined` ⇒ no worktree-safe continue; launcher uses
   * {@link blank}.
   */
  continueOrBlank?(): LaunchSpec;
  /**
   * Resume a prior conversation in the CWD, falling back to seeding a
   * fresh one with the prompt. `undefined` ⇒ launcher uses {@link seed}.
   */
  continueOrSeed?(prompt: string, opts?: SeedOptions): LaunchSpec;
}

// Env var names for the shell-composed `continue || seed` path.
export const SEED_PROMPT_ENV = 'N10_SEED_PROMPT';
export const SEED_SYSTEM_ENV = 'N10_SEED_SYSTEM';

/**
 * Run `script` through `/bin/sh`, for the `continue || fallback` paths
 * that need a shell for the `||`. Every launch goes through tmux, which
 * has no native Windows build — see `docs/decisions.md`.
 */
const shellInvoke = (script: string): Pick<LaunchSpec, 'cmd' | 'args'> => ({
  cmd: '/bin/sh',
  args: ['-c', script],
});

/**
 * Reference an environment variable in a shell script, in the syntax
 * `/bin/sh` expands: `$NAME`.
 */
const shellEnvRef = (name: string): string => `$${name}`;

const CLAUDE: AgentDefinition = {
  id: 'claude',
  name: 'Claude',
  supportsAppendSystemPrompt: true,
  blank: () => ({ cmd: 'claude', args: [] }),
  resume: (prompt, opts) => ({
    cmd: 'claude',
    args: [
      '--continue',
      ...(opts?.appendSystemPrompt
        ? ['--append-system-prompt', opts.appendSystemPrompt]
        : []),
      ...(prompt ? [prompt] : []),
    ],
  }),
  seed: (prompt, opts) =>
    opts?.appendSystemPrompt
      ? {
          cmd: 'claude',
          args: ['--append-system-prompt', opts.appendSystemPrompt, prompt],
        }
      : { cmd: 'claude', args: [prompt] },
  continueOrBlank: () => shellInvoke('claude --continue || claude'),
  continueOrSeed: (prompt, opts) => {
    const sys = opts?.appendSystemPrompt;
    const fresh = sys
      ? `claude --append-system-prompt "${shellEnvRef(
          SEED_SYSTEM_ENV
        )}" "${shellEnvRef(SEED_PROMPT_ENV)}"`
      : `claude "${shellEnvRef(SEED_PROMPT_ENV)}"`;
    return {
      ...shellInvoke(`claude --continue || ${fresh}`),
      env: {
        [SEED_PROMPT_ENV]: prompt,
        ...(sys ? { [SEED_SYSTEM_ENV]: sys } : {}),
      },
    };
  },
};

const COPILOT: AgentDefinition = {
  id: 'copilot',
  name: 'Copilot',
  supportsAppendSystemPrompt: false,
  blank: () => ({ cmd: 'copilot', args: [] }),
  // `-i` starts an interactive session seeded with the prompt (verified
  // empirically). `-p` is the one-shot programmatic mode that exits, so
  // we deliberately don't use it for a live pane.
  seed: (prompt) => ({ cmd: 'copilot', args: ['-i', prompt] }),
  // `copilot --continue` resumes the most-recently-closed session
  // globally, not the one for this worktree — unsafe, so no continue.
};

const CODEX: AgentDefinition = {
  id: 'codex',
  name: 'Codex',
  supportsAppendSystemPrompt: false,
  blank: () => ({ cmd: 'codex', args: [] }),
  resume: (prompt) => ({
    cmd: 'codex',
    args: ['resume', '--last', ...(prompt ? [prompt] : [])],
  }),
  seed: (prompt) => ({ cmd: 'codex', args: [prompt] }),
};

const GEMINI: AgentDefinition = {
  id: 'gemini',
  name: 'Gemini',
  supportsAppendSystemPrompt: false,
  blank: () => ({ cmd: 'gemini', args: [] }),
  // `-i`/`--prompt-interactive` seeds an interactive session; `-p` is
  // the headless mode that exits.
  seed: (prompt) => ({ cmd: 'gemini', args: ['-i', prompt] }),
};

const OPENCODE: AgentDefinition = {
  id: 'opencode',
  name: 'OpenCode',
  supportsAppendSystemPrompt: false,
  blank: () => ({ cmd: 'opencode', args: [] }),
  seed: (prompt) => ({ cmd: 'opencode', args: ['--prompt', prompt] }),
  // `--continue`/`-c` scope is undocumented — treat as unsafe for now.
};

/** The user-selectable agents, in settings-display order. */
export const AGENTS: readonly AgentDefinition[] = [
  CLAUDE,
  CODEX,
  GEMINI,
  COPILOT,
  OPENCODE,
];

/**
 * The hidden test-runner agent. Runs an arbitrary command through
 * `sh -c` so the e2e harness can drive n10 with fake agents (`cat`,
 * `sleep 300`, the fake-agent script, …). Not shown in settings; only
 * reachable when the resolved id is `test`.
 */
export function makeTestAgent(rawCommand: string): AgentDefinition {
  return {
    id: 'test',
    name: 'Test Runner',
    hidden: true,
    supportsAppendSystemPrompt: false,
    blank: () => shellInvoke(rawCommand),
    resume: () => shellInvoke(rawCommand),
    // Seeding a fake is best-effort: run the raw command and expose the
    // prompt via env for fakes that choose to read it.
    seed: (prompt) => ({
      ...shellInvoke(rawCommand),
      env: { [SEED_PROMPT_ENV]: prompt },
    }),
  };
}

const KNOWN_IDS = new Set<string>(AGENTS.map((a) => a.id));

/**
 * Map a legacy `aiCommand` string back to an agent id. Recognized
 * preset commands map to their agent; anything else (custom wrappers,
 * the e2e fakes) routes to the hidden test runner so it runs verbatim.
 */
export function agentIdFromCommand(
  aiCommand: string | undefined
): ResolvedAgentId {
  if (!aiCommand) return 'claude';
  const cmd = aiCommand.trim();
  if (cmd.startsWith('claude')) return 'claude';
  if (cmd.startsWith('codex')) return 'codex';
  if (cmd.startsWith('gemini')) return 'gemini';
  if (
    cmd === 'copilot' ||
    cmd.startsWith('copilot ') ||
    cmd.startsWith('gh copilot')
  )
    return 'copilot';
  if (cmd.startsWith('opencode')) return 'opencode';
  return 'test';
}

/**
 * Resolve the agent to launch for a config. Prefers the explicit
 * `agentId`; otherwise migrates the legacy `aiCommand`. Unknown ids and
 * the `test` id resolve to the hidden test runner bound to `aiCommand`.
 */
export function resolveAgent(config: AppConfig): AgentDefinition {
  const id: ResolvedAgentId =
    config.agentId ?? agentIdFromCommand(config.aiCommand);
  if (id === 'test') return makeTestAgent(config.aiCommand ?? '');
  const found = AGENTS.find((a) => a.id === id);
  return found ?? CLAUDE;
}

export function isKnownAgentId(id: string): id is AgentId {
  return KNOWN_IDS.has(id);
}
