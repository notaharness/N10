/**
 * The durable per-peer outbound queue: `mailbox/out/<peerId>/`, one file per
 * undelivered message, written temp-then-rename and named by zero-padded
 * seq so the directory sorts into send order. See docs/beam.md.
 */

import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { assertPeerId } from '../identifiers.js';
import { isEnvelope, type Envelope } from './envelope.js';
import {
  isAtLimit,
  resolveQueueLimits,
  type QueueLimits,
} from './queue-limits.js';

const REASON_SUFFIX = '.reason';

const SEQ_PAD = 10;

export interface QuarantinedFile {
  peerId: string;
  fileName: string;
  reason: string;
}

export interface QueuedEnvelope {
  envelope: Envelope;
  fileName: string;
}

export interface OutboundQueueOptions {
  /** Called whenever a file is quarantined (moved aside as unreadable) —
   * the caller decides whether/how to log it. */
  onQuarantine?: (info: QuarantinedFile) => void;
  /** Per-peer bounds; defaults in queue-limits.ts. */
  limits?: Partial<QueueLimits>;
}

export class OutboundQueue {
  private readonly root: string;
  private readonly onQuarantine?: (info: QuarantinedFile) => void;
  private readonly limits: QueueLimits;

  constructor(beamDir: string, options: OutboundQueueOptions = {}) {
    this.root = join(beamDir, 'mailbox', 'out');
    this.onQuarantine = options.onQuarantine;
    this.limits = resolveQueueLimits(options.limits);
    this.reapStaleTemp();
  }

  /** Whether this peer's queue is at either bound. A peer that has been
   * offline for a week, or one being sent to faster than it drains, must
   * not be able to fill the disk this node's own mail lives on. */
  isFull(peerId: string): boolean {
    return isAtLimit(this.peerDir(peerId), this.limits);
  }

  /** Remove leftover `<seq>.json.<pid>.tmp` files at startup: `enqueue`'s
   * write-then-rename is atomic for the target file, but a crash between
   * the write and the rename can still orphan the temp file itself, which
   * would otherwise accumulate forever (it is invisible to `list()`, which
   * only looks at `*.json`). */
  private reapStaleTemp(): void {
    for (const peerId of this.peerIds()) {
      const dir = this.peerDir(peerId);
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.tmp')) continue;
        try {
          unlinkSync(join(dir, name));
        } catch {
          // Already gone — fine.
        }
      }
    }
  }

  /** Every queue path goes through here, and asserts the id's shape first:
   * this is the boundary where a peer-supplied string would otherwise
   * become a path segment (identifiers.ts). */
  private peerDir(peerId: string): string {
    return join(this.root, assertPeerId(peerId));
  }

  private fileName(seq: number): string {
    return `${String(seq).padStart(SEQ_PAD, '0')}.json`;
  }

  /** Durable write: temp file, then rename over the target. A reader never
   * observes a partially written envelope — the crash window this closes
   * is "wrote the file, crashed before sending": on restart, the file is
   * either fully there or not there at all.
   *
   * Exclusive create (D2): a name collision — a file already sitting at
   * this seq's path — is a fatal inconsistency, not something to rename
   * over. `SeqCounter.next()` is what is supposed to make every seq handed
   * to `enqueue` unique; if one collides anyway, silently overwriting it
   * would clobber a still-queued, undelivered message, which is worse than
   * failing loudly. */
  enqueue(peerId: string, envelope: Envelope): void {
    const dir = this.peerDir(peerId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, this.fileName(envelope.seq));
    if (existsSync(target)) {
      throw new Error(
        `refusing to overwrite an already-queued message for ${peerId} at seq ${envelope.seq} (${target})`
      );
    }
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
    try {
      // `linkSync`, not `renameSync`: rename replaces an existing
      // destination silently, and the `existsSync` above cannot close the
      // window between the check and the write. Link fails when the target
      // exists, so a same-seq race between two processes is always a loud
      // error and never a queued envelope that simply disappeared. The
      // target is the temp file's own fully-written inode, so a reader
      // still never sees a partial envelope.
      linkSync(tmp, target);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // The link succeeded or it did not; either way the temp name is
        // no longer needed and failing to clear it is not fatal.
      }
    }
  }

  /** Every undelivered envelope for a peer, oldest (lowest seq) first. A
   * file that cannot be parsed as an Envelope is quarantined — moved into
   * a `corrupt/` subdirectory — rather than left to block every message
   * behind it forever. */
  list(peerId: string): QueuedEnvelope[] {
    const dir = this.peerDir(peerId);
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    const out: QueuedEnvelope[] = [];
    for (const name of names) {
      const parsed = this.tryRead(dir, name);
      if (parsed) out.push({ envelope: parsed, fileName: name });
    }
    return out;
  }

  private tryRead(dir: string, name: string): Envelope | null {
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), 'utf8');
    } catch {
      return null; // Removed concurrently (e.g. by another drain); skip.
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.quarantine(
        dir,
        name,
        `unparseable JSON: ${(error as Error).message}`
      );
      return null;
    }
    if (!isEnvelope(parsed)) {
      this.quarantine(dir, name, 'does not look like an envelope');
      return null;
    }
    return parsed;
  }

  /** Move a queue file aside as unsendable. Quarantine is not only for a
   * file that cannot be *read*: an envelope that cannot be encoded onto
   * the wire is just as undeliverable, and leaving it at the head of the
   * queue blocks every message behind it forever. Loud and durable either
   * way — it shows up in `quarantined()` across a restart. */
  quarantineFile(peerId: string, fileName: string, reason: string): void {
    this.quarantine(this.peerDir(peerId), fileName, reason);
  }

  remove(peerId: string, fileName: string): void {
    try {
      unlinkSync(join(this.peerDir(peerId), fileName));
    } catch {
      // Already gone — fine, that is the point of unlinking.
    }
  }

  depth(peerId: string): number {
    return this.list(peerId).length;
  }

  /** Every peerId with a queue directory on disk, for the node-start flush
   * and for `status`/`msg queue` across all peers. */
  peerIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  /** Every file quarantined for `peerId`, so `beam msg queue` and any other
   * diagnostic surface can show what was lost (D1) — durable across a
   * restart, since both the file and its reason stay on disk in `corrupt/`
   * rather than only ever being reported through the transient
   * `onQuarantine` callback. */
  quarantined(peerId: string): QuarantinedFile[] {
    const dir = join(this.peerDir(peerId), 'corrupt');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort()
      .map((fileName) => ({
        peerId,
        fileName,
        reason: this.readQuarantineReason(dir, fileName),
      }));
  }

  private readQuarantineReason(dir: string, fileName: string): string {
    try {
      return readFileSync(join(dir, `${fileName}${REASON_SUFFIX}`), 'utf8');
    } catch {
      return 'reason unavailable';
    }
  }

  private quarantine(dir: string, name: string, reason: string): void {
    const quarantineDir = join(dir, 'corrupt');
    const peerId = dir.slice(this.root.length + 1);
    try {
      mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
      renameSync(join(dir, name), join(quarantineDir, name));
      try {
        writeFileSync(join(quarantineDir, `${name}${REASON_SUFFIX}`), reason, {
          mode: 0o600,
        });
      } catch {
        // Best-effort: the file is still quarantined and discoverable even
        // without its reason recorded alongside it.
      }
    } catch {
      // If even the rename fails there is nothing more to safely do; the
      // caller already skips this file either way.
    }
    this.onQuarantine?.({ peerId, fileName: name, reason });
  }
}
