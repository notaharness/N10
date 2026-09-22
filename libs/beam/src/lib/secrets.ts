/**
 * Single-use, time-limited secrets: pairing tokens (10 min), challenge
 * nonces (60s), and connection tickets (30s) all reuse this accounting.
 * See docs/beam.md.
 */

import { randomBytes } from 'node:crypto';

/** Base64url of `n` random bytes — the shape of every secret minted here. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export type ConsumeResult<T> = { valid: true; payload: T } | { valid: false };

/**
 * Secrets with an attached payload, a TTL, and single use: `consume`
 * succeeds at most once per secret, and only within the TTL. Unknown,
 * expired, and already-spent secrets all fail identically, which is what
 * keeps a stale or forged value indistinguishable from a spent one.
 */
export class SingleUseSecrets<T> {
  private issued = new Map<string, { payload: T; issuedAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly mint: () => string = randomSecret
  ) {}

  /** Mint a fresh secret valid for the TTL, carrying `payload`. */
  issue(payload: T): string {
    this.sweep();
    const secret = this.mint();
    this.issued.set(secret, { payload, issuedAt: this.now() });
    return secret;
  }

  /** Consume a secret: valid exactly once, and only within the TTL. */
  consume(secret: string): ConsumeResult<T> {
    const entry = this.issued.get(secret);
    if (entry === undefined) return { valid: false };
    this.issued.delete(secret);
    if (this.now() - entry.issuedAt > this.ttlMs) return { valid: false };
    return { valid: true, payload: entry.payload };
  }

  /** Read a secret's payload without spending it. Same TTL rule as
   * `consume`, and the same indistinguishable failure for unknown,
   * expired and already-spent. It exists so a caller can check something
   * *about* a secret before deciding whether to spend it — verifying a
   * proof first is what stops a bogus one burning the legitimate holder's
   * secret. */
  peek(secret: string): ConsumeResult<T> {
    const entry = this.issued.get(secret);
    if (entry === undefined) return { valid: false };
    if (this.now() - entry.issuedAt > this.ttlMs) return { valid: false };
    return { valid: true, payload: entry.payload };
  }

  /** Drop expired entries so un-presented secrets cannot grow memory. */
  private sweep(): void {
    const now = this.now();
    for (const [secret, entry] of this.issued) {
      if (now - entry.issuedAt > this.ttlMs) this.issued.delete(secret);
    }
  }
}

/** Default lifetimes from docs/beam.md. */
export const PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;
export const CHALLENGE_TTL_MS = 60 * 1000;
export const TICKET_TTL_MS = 30 * 1000;
