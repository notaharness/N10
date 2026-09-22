/**
 * The environment beam injects into every `pty` and `exec` child (see
 * docs/beam.md's "Injected environment" section): it is how a script beam
 * started answers the machine that started it, without being configured.
 * Nothing secret ever goes in — no private key, ticket, or pairing token.
 */

import type { StreamContext } from './stream.js';

/** Static, per-node facts every injected environment carries — fixed for
 * the life of the node, unlike the per-stream caller identity. */
export interface NodeEnvContext {
  /** `$BEAM_DIR` in use. */
  beamDir: string;
  /** Path to the local IPC socket, present while this node runs. */
  inboxSocketPath: string;
  /** This machine's own peerId. */
  ownPeerId: string;
}

/**
 * Build the environment for a spawned `pty`/`exec` child: the host's own
 * environment, then any caller-provided overrides (exec's "merges over the
 * host's environment"), then the fixed `BEAM_*` facts last — so a caller
 * cannot spoof who it is by naming one of those keys in its own `env`.
 */
export function injectedEnv(
  node: NodeEnvContext,
  caller: StreamContext,
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    ...overrides,
    BEAM_DIR: node.beamDir,
    BEAM_INBOX: node.inboxSocketPath,
    BEAM_PEER_ID: node.ownPeerId,
    BEAM_CALLER_ID: caller.peerId,
    BEAM_CALLER_LABEL: caller.label,
  };
}
