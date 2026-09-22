import { describe, expect, it } from 'vitest';
import { SingleUseSecrets } from './secrets.js';

describe('SingleUseSecrets', () => {
  it('a freshly issued secret consumes successfully exactly once', () => {
    const secrets = new SingleUseSecrets<undefined>(1000);
    const secret = secrets.issue(undefined);
    expect(secrets.consume(secret)).toEqual({
      valid: true,
      payload: undefined,
    });
    expect(secrets.consume(secret)).toEqual({ valid: false });
  });

  it('carries a payload from issue through to consume', () => {
    const secrets = new SingleUseSecrets<string>(1000);
    const secret = secrets.issue('peer-a');
    expect(secrets.consume(secret)).toEqual({ valid: true, payload: 'peer-a' });
  });

  it('rejects an unknown secret', () => {
    const secrets = new SingleUseSecrets<undefined>(1000);
    expect(secrets.consume('never-issued')).toEqual({ valid: false });
  });

  it('rejects a secret once its TTL has elapsed, even unconsumed', () => {
    let now = 0;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);
    now = 1001;
    expect(secrets.consume(secret)).toEqual({ valid: false });
  });

  it('accepts a secret right up to the TTL boundary', () => {
    let now = 0;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);
    now = 1000;
    expect(secrets.consume(secret).valid).toBe(true);
  });

  it('mints distinct secrets on each issue', () => {
    const secrets = new SingleUseSecrets<undefined>(1000);
    const a = secrets.issue(undefined);
    const b = secrets.issue(undefined);
    expect(a).not.toBe(b);
  });
});

/**
 * Every TTL here is `Date.now()` arithmetic, and `Date.now` is a wall clock
 * an NTP step, a suspend/resume or a manual `date` can move in either
 * direction. These pin down what that does, and the judgement that it is
 * not worth a monotonic clock:
 *
 * - A jump *backwards* lengthens the window an unspent secret stays valid
 *   in. The bound is the jump plus the original TTL, not the TTL: validity
 *   is judged against the wall clock reading at issue, so a secret issued
 *   at T stays usable until the clock next reads `T + ttl`, which after a
 *   rewind of D is D later in real time. That is the whole of the
 *   exposure, and it widens no attack on its own: every secret here is 32
 *   random bytes, so
 *   a longer window is not a longer guess; the secret is still single-use,
 *   so a jump can never revive a spent one; and the three consumers add
 *   their own binding on top — a challenge is minted for one named peer, a
 *   ticket needs a `beam-ws` signature from the key of the peer it was
 *   issued to, and a pairing token is a bearer secret for its window
 *   whatever the clock says.
 * - A jump *forwards* expires secrets early, which fails closed: the
 *   caller is told the secret is no longer usable and mints another.
 */
describe('SingleUseSecrets under a wall clock that jumps', () => {
  it('a backward jump keeps an unspent secret valid until the clock climbs back past its TTL', () => {
    let now = 10_000;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);

    // The clock steps back an hour, well past the point this would have
    // expired on a monotonic one.
    now = 10_000 - 3_600_000;
    expect(secrets.peek(secret).valid).toBe(true);

    // Still valid an hour of rewound time later, because the comparison is
    // against the reading the clock had at issue: the rewind does not
    // restart the TTL, it postpones its end.
    now = 10_000 - 3_600_000 + 1001;
    expect(secrets.peek(secret).valid).toBe(true);

    // It expires when the clock gets back past `issuedAt + ttl`, and not
    // before — so the extension really is bounded by the size of the jump
    // rather than being indefinite.
    now = 11_001;
    expect(secrets.consume(secret)).toEqual({ valid: false });
  });

  it('a forward jump expires an unspent secret early — the safe direction', () => {
    let now = 0;
    const secrets = new SingleUseSecrets<undefined>(60_000, () => now);
    const secret = secrets.issue(undefined);
    now = 3_600_000;
    expect(secrets.consume(secret)).toEqual({ valid: false });
  });

  it('single use survives a backward jump: a spent secret is not revived by one', () => {
    let now = 10_000;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);
    expect(secrets.consume(secret).valid).toBe(true);

    now = 10_000 - 3_600_000;
    expect(secrets.consume(secret)).toEqual({ valid: false });
    expect(secrets.peek(secret)).toEqual({ valid: false });
  });

  it('a backward jump does not resurrect a secret that had already expired before it', () => {
    let now = 10_000;
    const secrets = new SingleUseSecrets<undefined>(1000, () => now);
    const secret = secrets.issue(undefined);

    // Expires on the forward clock. `consume` drops the entry as it
    // refuses it, so there is nothing left for a later jump to revalidate
    // — the exposure really is bounded to secrets nobody has presented.
    now = 12_000;
    expect(secrets.consume(secret)).toEqual({ valid: false });

    now = 10_000 - 3_600_000;
    expect(secrets.peek(secret)).toEqual({ valid: false });
  });
});
