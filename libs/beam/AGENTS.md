# libs/beam — @n10/beam

Pairs two machines and carries streams between them: identity, the symmetric
peer table, the frame protocol, mutual auth, the host's HTTP + WebSocket
surface, the client's pair/dial flow, the `pty`/`exec`/`msg` stream handlers,
and the durable mailbox. See `docs/beam.md` at the repository root for the
full contract — that document, not this file, is authoritative on wire
format and behavior.

No n10, git, tmux or Orchestra imports (lint-enforced by the workspace's
project boundaries): this library knows nothing about worktrees, agents,
report kinds or `@orchestra-*` tags. `apps/beam`, `apps/desktop` and the
Orchestra plugin's shell scripts are the only intended consumers, all
through the exported API in `src/index.ts`.

- **Identity and trust** (`identity.ts`, `peer-table.ts`, `auth.ts`): a
  `peerId` is always derived from a public key (`derivePeerId`), never
  asserted over the wire — `pair()` re-derives the host's claimed id and
  rejects a mismatch rather than trusting it (see `client.ts`). Revocation
  must be effective everywhere a peer is checked: `/challenge`, `/session`,
  the WS upgrade (ticket alone is not enough — the peer's current state is
  re-checked at upgrade time), and any already-live connection.
- **Frame protocol and muxer** (`protocol.ts`, `muxer.ts`, `stream.ts`): the
  wire codec is pure and has no I/O; another implementation matches it byte
  for byte. `Open`'s payload carries the stream name and its JSON parameters
  in one frame (a `{`-prefixed payload), never a name followed by a separate
  parameter frame — the latter cannot be told apart from the stream's first
  real byte of data by a handler with optional parameters. `seq` counts
  every frame on a stream (Open, Data, Close), not just Data; the
  `SeqTracker` verdict is enforced, not merely computed — a gap closes the
  stream rather than being delivered as data. `FrameDecoder.finish()` is
  wired into the real transport-end path (`connection.ts`), so a connection
  that dies mid-frame is reported as truncated, not as an ordinary close.
- **Connections** (`connection.ts`, `connection-registry.ts`): a
  `PeerConnection` is identical whether this machine dialed or accepted —
  that symmetry is what lets the mailbox drain over whichever connection
  exists, regardless of who opened it. Both `Host` (accepted) and `dial()`
  (dialed) register every live connection into a `ConnectionRegistry`; a
  mailbox flusher that only checked one side would silently fail to reach
  half of its peers. Revocation uses `terminate()`, never `close()`:
  a graceful WebSocket close is a handshake the peer can decline, and `ws`
  keeps delivering its frames for the whole 30s close timeout while it waits.
  `Muxer.receive`/`handleOpen` drop frames once disposed for the same reason,
  so no transport can spawn a process after its connection was reaped;
  ordinary shutdowns still close politely.
- **Liveness** (`liveness.ts`): process death arrives as a FIN; machine and
  network death arrive as nothing at all, and a socket nothing writes to
  stays ESTABLISHED indefinitely. Every connection on both sides therefore
  pings every 10s and terminates the transport after 10s without a pong.
  A pong comes from the peer's `ws` layer, so it proves the far process's
  event loop is running, never that its application is making progress —
  do not reach for this timer to catch an application-level stall. Tests
  for it use real sockets (`src/test-support/hostile-peer.ts`): a peer
  that accepts and never answers, and a peer process `SIGSTOP` can freeze
  mid-stream. A fake `TransportSocket` cannot express either failure,
  which is why this whole class went uncovered.
- **Streams** (`pty-handler.ts`, `exec-handler.ts`): a handler is registered
  once on a `StreamRegistry` shared by every connection on a node, so its
  own bookkeeping must key on `(peer, streamId)`, never bare `streamId` —
  stream ids are only unique within one connection, and two peers can each
  open id 1 at the same moment. `argv[0]` always runs directly; nothing here
  ever passes a caller's argv through a shell. `exec`'s stdin EOF is an
  explicit Control message (`{ kind: 'stdin-eof' }`), not a zero-length Data
  frame. Every child stream and every raw socket in this library needs an
  `'error'` listener, even a swallowing one: an EventEmitter that emits
  `'error'` with nobody listening throws, and an uncaught throw from a
  connection any paired peer controls the timing of is a remote kill
  switch — this applies to a child's stdin/stdout/stderr, accepted sockets
  on `ipc-socket.ts`, and the raw upgrade socket in `host.ts`, not only the
  transport's own WebSocket.
- **Injected environment** (`injected-env.ts`): `BEAM_DIR`, `BEAM_INBOX`,
  `BEAM_PEER_ID`, `BEAM_CALLER_ID`, `BEAM_CALLER_LABEL` are appended last, so
  a caller's own `env` open parameter cannot spoof who it is. Never inject a
  private key, a ticket or a pairing token into a child's environment.
- **Durable mailbox** (`mailbox/`): one queue per peer, not per role or
  direction — `mailbox/out/<peerId>/`, drained strictly sequentially
  (send, await ack, unlink, next) over whichever connection to that peer is
  live. `queued` is a success outcome, not a pending failure: the message is
  durable and the caller must not resend it. The receiver dedups by
  persisting the highest accepted `seq` per sender and accepts any `seq`
  greater than that — there is no contiguity requirement. Ordering still
  holds: the sender drains strictly sequentially over one ordered transport,
  so the receiver cannot observe reordering; contiguity never provided that,
  only detection of a sender-side loss the sender already knows about. A
  malformed queue file is quarantined (moved to `corrupt/`), not left to
  block the messages behind it, and quarantine is loud, never silent: it is
  logged, handed to `onQuarantine`, and stays discoverable afterwards
  through `Mailbox.quarantined()`/`OutboundQueue.quarantined()`, across a
  restart, since the file and its reason stay on disk. `enqueue` never
  overwrites an existing queue file — a seq collision is a thrown fatal
  error, not something to rename over. `SeqCounter` (`mailbox/seq.json`)
  throws on an unreadable or unparseable file rather than silently
  restarting numbering at 1, and reconciles every `next()` against the
  highest seq already on that peer's own disk (queued or quarantined) so a
  _lost_ counter file cannot reissue a seq this node already wrote down —
  though a seq already delivered and unlinked before the loss leaves no
  on-disk trace to reconcile against, a residual window reconciliation
  cannot close from local state alone. The PTY cap
  (`pty-handler.ts`'s `MAX_PTY_SESSIONS`) and revocation
  (`Flusher`'s `isRevoked`) are both enforced per peer, not globally across
  the node — one peer must not be able to consume another's budget, and
  revoking a peer must stop its queued mail even if something closes its
  connection without also revoking it.
- **Local IPC** (`ipc-socket.ts`): `$BEAM_DIR/run/inbox.sock`, mode `0600`,
  line-delimited JSON. Only remove a stale socket left by a crashed node;
  check liveness before unlinking one a running node may still own.
