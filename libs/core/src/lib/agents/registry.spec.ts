import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import {
  AGENTS,
  agentIdFromCommand,
  makeTestAgent,
  resolveAgent,
  isKnownAgentId,
  SEED_PROMPT_ENV,
  SEED_SYSTEM_ENV,
} from './registry.js';

function config(partial: Partial<AppConfig>): AppConfig {
  return { vendorAuth: {}, vendorProject: {}, ...partial };
}

/**
 * The shell a shell-composed launch runs under. Spelled out rather
 * than imported so these stay assertions about concrete values. Every
 * launch goes through tmux, which has no native Windows build, so
 * `/bin/sh` is the only shell in play — see `docs/decisions.md`.
 */
const SHELL_CMD = '/bin/sh';
const SHELL_FLAGS = ['-c'];
/** How an env var is referenced in a script that shell will expand. */
const envRef = (name: string) => `$${name}`;
/** A full spec for a one-script launch under that shell. */
const shellSpec = (script: string) => ({
  cmd: SHELL_CMD,
  args: [...SHELL_FLAGS, script],
});
/** Index of the script within `args`, after the shell's own flags. */
const SCRIPT_ARG = SHELL_FLAGS.length;

describe('agent registry', () => {
  it('exposes the five user-selectable agents, none hidden', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'claude',
      'codex',
      'gemini',
      'copilot',
      'opencode',
    ]);
    expect(AGENTS.every((a) => !a.hidden)).toBe(true);
  });

  describe('agentIdFromCommand', () => {
    it('defaults to claude when empty', () => {
      expect(agentIdFromCommand(undefined)).toBe('claude');
      expect(agentIdFromCommand('')).toBe('claude');
    });

    it('maps legacy preset strings back to their agent', () => {
      expect(agentIdFromCommand('claude --continue || claude')).toBe('claude');
      expect(agentIdFromCommand('codex')).toBe('codex');
      expect(agentIdFromCommand('gemini')).toBe('gemini');
      expect(agentIdFromCommand('copilot')).toBe('copilot');
      expect(agentIdFromCommand('gh copilot')).toBe('copilot');
      expect(agentIdFromCommand('opencode')).toBe('opencode');
    });

    it('routes unrecognized commands to the hidden test runner', () => {
      expect(agentIdFromCommand('cat')).toBe('test');
      expect(agentIdFromCommand('echo hi && sleep 300')).toBe('test');
      expect(agentIdFromCommand('node /tmp/fake-agent.mjs')).toBe('test');
    });
  });

  describe('resolveAgent', () => {
    it('prefers explicit agentId over aiCommand', () => {
      const agent = resolveAgent(
        config({ agentId: 'codex', aiCommand: 'cat' })
      );
      expect(agent.id).toBe('codex');
    });

    it('migrates legacy aiCommand when agentId is unset', () => {
      expect(resolveAgent(config({ aiCommand: 'gemini' })).id).toBe('gemini');
    });

    it('routes an unrecognized aiCommand to the test runner that runs it raw', () => {
      const agent = resolveAgent(config({ aiCommand: 'cat' }));
      expect(agent.id).toBe('test');
      expect(agent.hidden).toBe(true);
      expect(agent.blank()).toEqual(shellSpec('cat'));
    });

    it('defaults to claude with an empty config', () => {
      expect(resolveAgent(config({})).id).toBe('claude');
    });
  });

  describe('launch specs', () => {
    const claude = AGENTS.find((a) => a.id === 'claude')!;
    const copilot = AGENTS.find((a) => a.id === 'copilot')!;
    const codex = AGENTS.find((a) => a.id === 'codex')!;
    const gemini = AGENTS.find((a) => a.id === 'gemini')!;
    const opencode = AGENTS.find((a) => a.id === 'opencode')!;

    it('claude blank / seed pass the prompt as one argv element', () => {
      expect(claude.blank()).toEqual({ cmd: 'claude', args: [] });
      expect(claude.seed!('weird \'quotes\' and "dquotes"')).toEqual({
        cmd: 'claude',
        args: ['weird \'quotes\' and "dquotes"'],
      });
    });

    it('claude seed uses --append-system-prompt when guidance is given', () => {
      expect(
        claude.seed!('do the thing', { appendSystemPrompt: 'be nice' })
      ).toEqual({
        cmd: 'claude',
        args: ['--append-system-prompt', 'be nice', 'do the thing'],
      });
    });

    it('claude continue-or-seed delivers the prompt via env, not the command string', () => {
      const spec = claude.continueOrSeed!('the plan');
      expect(spec.cmd).toBe(SHELL_CMD);
      expect(spec.args.slice(0, SCRIPT_ARG)).toEqual(SHELL_FLAGS);
      expect(spec.args[SCRIPT_ARG]).toBe(
        `claude --continue || claude "${envRef(SEED_PROMPT_ENV)}"`
      );
      expect(spec.args[SCRIPT_ARG]).not.toContain('the plan');
      expect(spec.env).toEqual({ [SEED_PROMPT_ENV]: 'the plan' });
    });

    it('claude continue-or-seed threads the system prompt via env too', () => {
      const spec = claude.continueOrSeed!('the plan', {
        appendSystemPrompt: 'guidance',
      });
      expect(spec.args[SCRIPT_ARG]).toBe(
        `claude --continue || claude --append-system-prompt "${envRef(
          SEED_SYSTEM_ENV
        )}" "${envRef(SEED_PROMPT_ENV)}"`
      );
      expect(spec.env).toEqual({
        [SEED_PROMPT_ENV]: 'the plan',
        [SEED_SYSTEM_ENV]: 'guidance',
      });
    });

    it('copilot seeds with -i and has no continue', () => {
      expect(copilot.seed!('hi')).toEqual({
        cmd: 'copilot',
        args: ['-i', 'hi'],
      });
      expect(copilot.continueOrBlank).toBeUndefined();
      expect(copilot.continueOrSeed).toBeUndefined();
    });

    it('codex/gemini/opencode seed with their respective flags', () => {
      expect(codex.seed!('p')).toEqual({ cmd: 'codex', args: ['p'] });
      expect(gemini.seed!('p')).toEqual({ cmd: 'gemini', args: ['-i', 'p'] });
      expect(opencode.seed!('p')).toEqual({
        cmd: 'opencode',
        args: ['--prompt', 'p'],
      });
    });

    it('runs the continue path through /bin/sh', () => {
      const script = 'claude --continue || claude';
      expect(claude.continueOrBlank!()).toEqual({
        cmd: '/bin/sh',
        args: ['-c', script],
      });
    });

    it('references the seed env vars in the syntax /bin/sh expands', () => {
      const script = claude.continueOrSeed!('p').args[SCRIPT_ARG];
      expect(script).toContain(`$${SEED_PROMPT_ENV}`);
    });

    it('only claude advertises append-system-prompt support', () => {
      expect(claude.supportsAppendSystemPrompt).toBe(true);
      for (const a of [copilot, codex, gemini, opencode]) {
        expect(a.supportsAppendSystemPrompt).toBe(false);
      }
    });
  });

  describe('makeTestAgent', () => {
    it('runs the raw command and exposes the seed prompt via env', () => {
      const agent = makeTestAgent('cat');
      expect(agent.blank()).toEqual(shellSpec('cat'));
      expect(agent.seed!('hello')).toEqual({
        ...shellSpec('cat'),
        env: { [SEED_PROMPT_ENV]: 'hello' },
      });
    });
  });

  describe('isKnownAgentId', () => {
    it('recognizes the public ids but not the hidden test runner', () => {
      expect(isKnownAgentId('claude')).toBe(true);
      expect(isKnownAgentId('opencode')).toBe(true);
      expect(isKnownAgentId('test')).toBe(false);
      expect(isKnownAgentId('nonsense')).toBe(false);
    });
  });
});
