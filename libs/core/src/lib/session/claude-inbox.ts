import {
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
} from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Claude Code session inboxes ─────────────────────────────────────
//
// A Claude Code session outside tmux is addressed as `claude:<session
// id>` (Orchestra's routing). Each live session has a registry file,
// `<config dir>/sessions/<pid>.json`, naming its `sessionId`, its inbox
// `messagingSocketPath`, its start time (`procStart`) and, in recent
// versions, the pid namespace of its pid (`pidDomain`). A session that
// exits uncleanly leaves the file and its socket behind, so neither is
// proof of life: the pid must exist, in this pid namespace when both
// sides can say, and have started when the file says. Matches
// Orchestra's `claude_registry_socket`.

/** `unregistered`: no registry file names the id; `not-live`: one does,
 *  but no live process answers on its socket. */
export type ClaudePost = 'delivered' | 'not-live' | 'unregistered';

interface RegistryEntry {
  sessionId?: unknown;
  messagingSocketPath?: unknown;
  procStart?: unknown;
  pidDomain?: unknown;
}

/** This process's `pidDomain` as Claude writes it; null where it cannot
 *  be read. */
function ownPidDomain(): string | null {
  try {
    const id = (
      existsSync('/etc/machine-id')
        ? readFileSync('/etc/machine-id', 'utf8')
        : readFileSync('/var/lib/dbus/machine-id', 'utf8')
    ).trim();
    const ns = readlinkSync('/proc/self/ns/pid');
    return id && ns ? `linux:${id}:${ns}` : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The process's start time, field 22 of `/proc/<pid>/stat`. */
function procStart(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

function liveSocket(entry: RegistryEntry, pid: number): string | null {
  const socket = entry.messagingSocketPath;
  if (typeof socket !== 'string') return null;
  const own = typeof entry.pidDomain === 'string' ? ownPidDomain() : null;
  if (own !== null && entry.pidDomain !== own) return null;
  if (!alive(pid)) return null;
  if (
    typeof entry.procStart === 'string' &&
    existsSync('/proc/self') &&
    procStart(pid) !== entry.procStart
  )
    return null;
  try {
    return statSync(socket).isSocket() ? socket : null;
  } catch {
    return null;
  }
}

/** Whether a registry file under `configDir` names `sessionId`, and the
 *  inbox socket of the live one, if any. */
function sessionSocket(
  configDir: string,
  sessionId: string
): { registered: boolean; socket: string | null } {
  let files: string[];
  try {
    files = readdirSync(join(configDir, 'sessions'));
  } catch {
    return { registered: false, socket: null };
  }
  let registered = false;
  for (const file of files) {
    const pid = /^(\d+)\.json$/.exec(file)?.[1];
    const entry = pid ? readEntry(join(configDir, 'sessions', file)) : null;
    if (entry?.sessionId !== sessionId) continue;
    registered = true;
    const socket = liveSocket(entry, Number(pid));
    if (socket) return { registered, socket };
  }
  return { registered, socket: null };
}

function readEntry(path: string): RegistryEntry | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RegistryEntry | null;
  } catch {
    return null;
  }
}

function post(socket: string, text: string): Promise<boolean> {
  const frame = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
  });
  return new Promise((resolve) => {
    const conn = connect(socket);
    conn.once('error', () => resolve(false));
    conn.once('connect', () =>
      conn.end(`${frame}\n`, () => {
        conn.destroy();
        resolve(true);
      })
    );
  });
}

/** `$CLAUDE_CONFIG_DIR` and `~/.claude`: an app started from a desktop
 *  launcher may not see the variable a terminal's Claude runs with. */
function defaultConfigDirs(): string[] {
  const dirs = [process.env['CLAUDE_CONFIG_DIR'], join(homedir(), '.claude')];
  return [...new Set(dirs.filter((d): d is string => !!d))];
}

/**
 * Posts `text` as one user message to the live Claude Code session
 * `sessionId`, found in the registry of one of `configDirs`. Nothing is
 * posted anywhere if no live session answers.
 */
export async function postToClaudeSession(
  sessionId: string,
  text: string,
  configDirs = defaultConfigDirs()
): Promise<ClaudePost> {
  let registered = false;
  for (const dir of configDirs) {
    const found = sessionSocket(dir, sessionId);
    registered ||= found.registered;
    if (found.socket && (await post(found.socket, text))) return 'delivered';
  }
  return registered ? 'not-live' : 'unregistered';
}
