import { tmuxListSessions } from '@n10/terminal-tmux';
import { getSession, sessionNames } from '../pty-registry.js';
import { sessionIdentity } from '../session-key.js';

// ── Relay targeting (decisions.md D14) ──────────────────────────────
//
// A mailbox envelope's payload carries a one-line "target: <local>"
// header, a blank line, then the message text — the framing
// report.sh's beam branch composes and relay.sh parses, matched here
// so the desktop relay reads exactly the same wire format. The target
// itself is data a peer sent and is never trusted directly: it is only
// ever resolved against this machine's own registry, never delivered
// because the envelope says so.

export interface ParsedRelayPayload {
  target: string;
  message: string;
}

/** Decodes `envelope.payload` per its `encoding` and splits report.sh's
 *  "target: <local>\n\n<message>" framing. `null` when the header is
 *  missing — a caller must refuse and leave the envelope unacked
 *  rather than guess a target. */
export function parseRelayPayload(
  payload: string,
  encoding: 'utf8' | 'base64'
): ParsedRelayPayload | null {
  const text =
    encoding === 'base64'
      ? Buffer.from(payload, 'base64').toString('utf8')
      : payload;
  const newline = text.indexOf('\n');
  if (newline === -1) return null;
  const headerLine = text.slice(0, newline);
  if (!headerLine.startsWith('target: ')) return null;
  const target = headerLine.slice('target: '.length);
  // The header is followed by a blank line, then the message — drop
  // exactly one more line if it is blank, matching relay.sh's
  // `tail -n +3`; a missing blank line still leaves a parseable target.
  const rest = text.slice(newline + 1);
  const message = rest.startsWith('\n') ? rest.slice(1) : rest;
  return { target, message };
}

export type LocalDeliveryTarget =
  | { kind: 'agent'; key: string }
  | { kind: 'refused'; reason: string };

function refused(reason: string): LocalDeliveryTarget {
  return { kind: 'refused', reason };
}

/** The registry entry (if any) whose live backend answers to `name` on
 *  this machine — the tmux name the registry itself allocated, not the
 *  internal registry key. Every registry entry is checked, local and
 *  remote alike, so a name that matches a session this desktop merely
 *  has a *client* open to (another machine's session) is still found,
 *  and then refused for what it is rather than silently missed. */
function findRegistryMatch(
  name: string
): { key: string; entry: NonNullable<ReturnType<typeof getSession>> } | null {
  for (const key of sessionNames()) {
    const entry = getSession(key);
    if (entry && entry.pty.name === name) return { key, entry };
  }
  return null;
}

/**
 * Resolve a relay target — a mailbox envelope's local part — to a
 * local, n10-managed agent session, or refuse it. Local state only
 * (D14): the envelope's target is never trusted on its own, only used
 * to look up something this machine's own registry already knows
 * about, matched by the tmux name n10 itself allocated. Orchestra's
 * `pane_owned_by_agent` is the same rule from the other side.
 */
export function resolveLocalRelayTarget(target: string): LocalDeliveryTarget {
  if (target.startsWith('codex:')) {
    return refused(
      "codex targets are not delivered by n10 desktop; use Orchestra's relay.sh for those"
    );
  }
  if (!target.startsWith('tmux:')) {
    return refused(`not a valid relay target: ${target}`);
  }
  const name = target.slice('tmux:'.length);
  const match = findRegistryMatch(name);
  if (!match) {
    return tmuxListSessions().includes(name)
      ? refused('that tmux session exists but is not managed by n10')
      : refused('no session by that name is known here');
  }
  const identity = sessionIdentity(match.key);
  if (identity && identity.machine !== 'local') {
    return refused('that session lives on another machine, not here');
  }
  if (match.entry.agent === undefined) {
    return refused('that session is a shell terminal, not an agent');
  }
  return { kind: 'agent', key: match.key };
}
