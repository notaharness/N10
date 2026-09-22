/**
 * Transport liveness — the half of "is this peer still there?" the kernel
 * cannot answer.
 *
 * A closed socket produces a FIN and every layer above learns of it at
 * once. A machine that is powered off, suspended, cut off from the network
 * or frozen mid-syscall produces nothing at all: the TCP connection stays
 * ESTABLISHED on this side indefinitely, so `ConnectionRegistry` keeps
 * reporting the peer as connected, the mailbox flusher keeps retrying
 * against it, and any UI above says "Connected" with total confidence. A
 * process suspended with SIGSTOP is the cheapest way to see it: nothing
 * about the socket changes until the process is actually killed.
 *
 * So the connection asks, on an interval, and destroys the transport when
 * the answer does not come. A WebSocket ping is the right question: it is
 * answered by the `ws` layer itself rather than by application code, so a
 * pong proves the far end's *process* is running its event loop, not that
 * some handler chose to reply. What that does not prove is that the far
 * side's application is making progress — a peer whose event loop spins
 * still pongs. Application-level stalls are the mailbox's ack timeout's
 * business, not this timer's.
 *
 * A pong is not the only answer that counts. It is an ordinary WebSocket
 * frame, written in order behind everything already queued on the socket,
 * so a peer whose output outruns the link answers late through no fault of
 * its own — a remote pane filling the send buffer puts megabytes in front
 * of the pong, and a healthy machine then reads as silent. Any inbound
 * frame therefore settles the question the ping asked (`noteInbound`):
 * bytes arriving prove the far end's event loop ran *and* that something
 * above it wrote, which is strictly more than a pong proves. It says
 * nothing new about the peer's *reading* side — a peer that sends without
 * ever reading still looks alive here, exactly as one that pongs without
 * reading already did. That boundary is unchanged and still the mailbox's.
 */

/** How often a live connection asks. Long enough to be free on battery and
 * on a metered link, short enough that a vanished machine is noticed in
 * tens of seconds rather than minutes, and well inside the ~30s idle
 * timeout of a typical NAT — the pings keep the path open as a side
 * effect. */
export const DEFAULT_PING_INTERVAL_MS = 10_000;

/** How long one ping may go unanswered before the transport is destroyed.
 * A whole interval, deliberately: a healthy peer under heavy CPU
 * contention, or one that is briefly suspended, must not be dropped, and
 * the `ws` layer answers a ping without waking application code, so a
 * second of slack is already generous. Worst case a peer that vanishes
 * immediately after a pong is noticed in `interval + timeout` (20s); the
 * typical case is nearer the timeout alone. */
export const DEFAULT_PONG_TIMEOUT_MS = 10_000;

export interface LivenessOptions {
  /** Default `DEFAULT_PING_INTERVAL_MS`. */
  intervalMs?: number;
  /** Default `DEFAULT_PONG_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** The transport capability a monitor needs: send a probe, hear the
 * answer. `TransportSocket` supplies it where the transport has one —
 * `ws` does; a future WebRTC data channel has its own. */
export interface LivenessProbe {
  ping(): void;
  onPong(handler: () => void): void;
}

export interface LivenessMonitor {
  /** Stop probing. Idempotent; a stopped monitor answers `checkAlive`
   * with `false` rather than probing a transport nobody owns any more. */
  stop(): void;
  /**
   * A frame arrived from the peer. Counts as an answer: it settles the
   * outstanding ping's deadline and every `checkAlive` in flight, exactly
   * as a pong does. Call it on every inbound frame — the common case,
   * with no ping outstanding and nobody waiting, costs two comparisons.
   */
  noteInbound(): void;
  /**
   * Probe once, now, and resolve with whether the peer answered inside
   * `timeoutMs`. Used where a caller is about to *rely* on this
   * connection and cannot afford to wait out the periodic timer — a
   * reconnect that would otherwise redial through a socket that can
   * never answer. A frame arriving from the peer inside the window
   * answers it as well as a pong does, so a connection busy enough to
   * delay the pong past `timeoutMs` still reports alive.
   */
  checkAlive(timeoutMs?: number): Promise<boolean>;
}

/**
 * Start pinging `probe` every `intervalMs`, calling `onSilent` when a ping
 * goes unanswered for `timeoutMs` — where "answered" is a pong or any
 * inbound frame the caller reports through `noteInbound`. One ping is
 * outstanding at a time: an interval that fires while an earlier ping is
 * still unanswered leaves that ping's deadline to decide.
 *
 * Both timers are unref'd. A node whose only remaining work is keeping an
 * idle connection honest should still be able to exit.
 */
export function startLiveness(
  probe: LivenessProbe,
  options: LivenessOptions,
  onSilent: (reason: string) => void
): LivenessMonitor {
  const intervalMs = options.intervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
  const waiters = new Set<() => void>();
  let stopped = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  /** Evidence of life, from whichever direction it came. It settles the
   * periodic ping and every one-shot check in flight, whichever of them
   * put the question on the wire. */
  const answered = (): void => {
    clearTimeout(deadline);
    deadline = undefined;
    for (const waiter of [...waiters]) waiter();
  };

  probe.onPong(answered);

  /** A transport that is already gone throws rather than pinging. That is
   * not an error worth propagating out of a timer callback: the deadline
   * this ping just armed reports it, and the transport's own close path
   * usually beats it there. */
  const safePing = (): boolean => {
    try {
      probe.ping();
      return true;
    } catch {
      return false;
    }
  };

  const tick = (): void => {
    if (stopped || deadline) return;
    deadline = setTimeout(() => {
      deadline = undefined;
      if (!stopped) onSilent(`no pong within ${timeoutMs}ms`);
    }, timeoutMs);
    deadline.unref?.();
    safePing();
  };

  const interval = setInterval(tick, intervalMs);
  interval.unref?.();

  return {
    // Hot path: every frame on a busy connection comes through here, so
    // the case with no ping outstanding and no waiter costs no work.
    noteInbound: () => {
      if (stopped || (deadline === undefined && waiters.size === 0)) return;
      answered();
    },
    stop: () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(deadline);
      deadline = undefined;
      for (const waiter of [...waiters]) waiter();
    },
    checkAlive: (ms) =>
      new Promise<boolean>((resolve) => {
        if (stopped) {
          resolve(false);
          return;
        }
        let settled = false;
        const finish = (alive: boolean): void => {
          if (settled) return;
          settled = true;
          waiters.delete(onPong);
          clearTimeout(timer);
          // A stopped monitor resolves its waiters too, so `alive` is
          // only trustworthy while the monitor is still running.
          resolve(alive && !stopped);
        };
        const onPong = (): void => finish(true);
        const timer = setTimeout(() => finish(false), ms ?? timeoutMs);
        timer.unref?.();
        waiters.add(onPong);
        if (!safePing()) finish(false);
      }),
  };
}
