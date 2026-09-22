# beam

beam pairs machines and carries streams between them. It replaces SSH as the way one
machine reaches another; it does not replace tmux, which still holds agent processes and
carries their identity. Everything about repositories, worktrees and agents lives above
beam: `libs/beam` never imports git, tmux or n10 concepts.

Consumers: `apps/beam` (standalone CLI), `apps/desktop` (multi-host UI), and the Orchestra
plugin's shell scripts through the CLI. The library has no n10-specific imports so it can be
published on its own later.

## Layering

| Layer                  | Owns                                                                  | Lives in                                  |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Orchestra scripts, n10 | worktrees, agent launch, report kinds, tag meanings                   | plugins repo, `libs/core`, `apps/desktop` |
| tmux                   | process persistence, `@orchestra-*` identity tags                     | one tmux server per machine               |
| beam                   | pairing, mutual auth, streams (`pty`, `exec`, `msg`), durable mailbox | `libs/beam`                               |
| network                | reachability                                                          | LAN, Tailscale, tailcat (later)           |

## Identity

One identity per machine, used whether the machine is accepting or dialing. There is no
separate "device" concept: a paired pair of machines are peers.

- **Keypair**: Ed25519, PEM, generated on first use, stored `$BEAM_DIR/identity.json`, mode
  `0600`. The private key never leaves the machine and is never sent over a connection.
- **`peerId`**: first 16 hex characters of the SHA-256 of the public key PEM. Derived, not
  minted, so both sides independently compute the same id for the same machine. (host-poc
  minted a random `deviceId` on the host; that cannot work symmetrically.)
- **`label`**: human name, defaults to the system hostname, local to each machine. Labels are
  display and lookup only; `peerId` is identity. Renaming a peer never changes its id.

`peerId`, `label` and `topic` all arrive from outside the machine and then become filesystem
path segments or get interpolated into output other tools parse, so each is checked at the
boundary rather than trusted. A `peerId` must be 16 lowercase hex characters — exactly what
the derivation produces — which is what keeps `mailbox/out/<peerId>/`, `mailbox/in/<peerId>/`
and `mailbox/seen/<peerId>.json` from ever being steered by one. `peerId` is the only one of
the three that reaches a path. A `label` (1–64 characters) and a `topic` (0–128, so the empty
topic `msg send` defaults to is valid and means "no topic") may not carry a path separator, a
brace, or a control character. Both are rejected, never sanitised: a label silently rewritten
is no longer the one the user compared out of band.

`$BEAM_DIR` is `$BEAM_CONFIG_DIR`, else `$XDG_CONFIG_HOME/beam`, else `~/.config/beam`.

```
$BEAM_DIR/
  identity.json          this machine's keypair + label            (0600)
  peers.json             the peer table                            (0600)
  mailbox/
    seq.json             send counter per recipient
    out/<peerId>/        one file per undelivered message
    in/<peerId>/         one file per received message not yet taken by a subscriber
    corrupt/             quarantined queue files, reported as lost
    seen/<peerId>.json   highest accepted seq from that peer
  run/inbox.sock         local IPC socket, present while a node runs (0600)
```

### Peer table

```ts
interface PeerRecord {
  peerId: string; // derived from publicKeyPem
  label: string; // local display name, unique within the table
  publicKeyPem: string; // used to verify everything this peer signs
  endpoints: string[]; // where we may dial it; may be empty
  pairedAt: number;
  lastSeenAt?: number;
  revoked: boolean; // kept, never matched, never dialed
}
```

Trust is symmetric (both sides hold the other's public key after one pairing). Reachability
is not: a peer can be dialed only if we know an endpoint for it and it is accepting. A peer
with no endpoint can still reach us, and we can still answer it — which is what lets a
laptop supervise a worker box without being reachable itself.

Endpoints are opaque strings. Nothing in the library assumes a direct IP, so a relayed or
tunnelled endpoint can be added later without touching this model.

## Pairing

Symmetric: one pairing act leaves both tables holding the other side's key.

1. B runs `beam serve`, which mints a single-use token (32 random bytes, base64url, 10 minute
   TTL) and prints a URL carrying it in the **hash**: `http://<endpoint>/pair#token=…`.
   The hash keeps the token out of request lines, proxy logs and `Referer`.
2. A runs `beam pair <url>`: it reads B's descriptor, then posts
   `{ token, publicKeyPem, label, endpoints }` — `endpoints` being where B may dial A back,
   empty when A does not accept connections.
3. B consumes the token (single use, whether or not the rest succeeds), stores A as a peer,
   and answers with its own `{ peerId, label, publicKeyPem, endpoints, protocol }`.
4. A stores B as a peer. Both sides can now authenticate the other.

A label collision on either side is resolved locally by appending `-2`, `-3`, …; the id is
what matters. Re-pairing an existing peer replaces its key only with `--force`, and the CLI
says which peer it would replace — a silent key swap is indistinguishable from an attacker.

Both sides gate that, not just the dialling one. `POST /pair` refuses (`already-paired`) a
re-pair that would change the key or `endpoints` it already stores for that peer unless the
body carries an explicit `replace`, which is what `--force` sends. A public key is not a
secret, so a live pairing token plus a peer's key would otherwise be enough to rewrite that
peer's record — and `endpoints` is where the mailbox flusher later dials. The token is spent
either way, so the endpoint never answers whether a given peer is already known.

### HTTP surface

Authentication only; no payload ever travels over HTTP. Bodies are capped at 64 KiB.

| Method | Path                     | Purpose                                                                        |
| ------ | ------------------------ | ------------------------------------------------------------------------------ |
| GET    | `/.well-known/beam/host` | descriptor: `{ peerId, label, protocol, capabilities }`                        |
| POST   | `/pair`                  | trade a token plus public key for mutual peer records                          |
| GET    | `/challenge/:peerId`     | `{ challenge }` — a nonce for that peer to sign (60s TTL)                      |
| POST   | `/session`               | mutual proof, returns `{ ticket, hostSignature }` (ticket 30s TTL, single use) |
| POST   | `/rtc`                   | WebRTC offer for a ticket, returns the answer                                  |
| GET    | `/ws?ticket=…&proof=…`   | upgrade to the stream connection; both are required                            |

The `peerId` in `/challenge/:peerId` and in the `/session` body is the **caller's own** id, looked
up in the accepting machine's peer table. That is what makes `unknown peer` and `revoked peer`
answerable at all: the accepting side is being asked to produce a nonce for, and then verify, a
specific peer it has a record of.

`POST /session` takes `{ peerId, challenge, signature, clientChallenge }`. The host verifies
the peer's signature **before** consuming the challenge, so a bogus signature cannot burn the
legitimate one. It then signs `clientChallenge` with its own key and returns that signature;
the client verifies it against the stored `publicKeyPem` and aborts on mismatch. Mutual proof
means neither side talks to an impostor, which matters because the WebSocket transport is not
itself encrypted.

`GET /ws` takes a `proof` as well as the `ticket`: the caller's signature over
`beam-ws:<ticket>`, verified against the public key stored for the peer the ticket was issued
to. The transport is not encrypted, so the ticket travels where anyone on the path can read
it; possession of it alone would let a passive attacker race the legitimate client for it.
The proof is verified **before** the ticket is consumed, for the same reason `/session`
verifies the signature before consuming the challenge — consume first and an attacker who
read the ticket could spend it with a garbage proof and burn the legitimate client's. The
peer whose key the proof is checked against comes from the ticket, never from the caller. The
`beam-ws:` prefix is domain separation from the `/session` challenge signature: without it a
signature captured from one exchange would verify in the other, since both are otherwise just
"this key signed this opaque string". The peer's current standing is re-checked after the
ticket is consumed, so a revocation inside the ticket's 30s window still takes effect.

The upgrade handler is reached before any of that — no ticket, no proof, no pairing record —
so the whole of it is wrapped, not just the parts that look risky. A request-target that is a
valid HTTP request line but not a parseable URL (`//[::1`, `http://[`, `//:`) gets a bare
`400 Bad Request` on that socket and nothing else on the node notices. Unguarded, one TCP
connection carrying such a request line is a kill switch over every other peer's connections
and the shells running on them (D3).

Failure modes are distinguishable where they can be, because the UI has to explain them: unknown
peer, revoked peer, bad signature, stale challenge, spent ticket, host key mismatch, already
paired under a record this pairing would change, invalid label.

One deliberate exception: a pairing token that is expired and one that has already been spent
answer identically. Single-use secrets are built so that unknown, expired and spent all fail the
same way, which is what stops the endpoint being an oracle for guessing tokens. So a UI can say the
token is no longer usable, and must not claim to know which.

## Frame protocol

Unchanged from host-poc. One ordered transport carries a control channel plus any number of
named streams.

```
header (12 bytes)                                  payload
+--------+---------+-----------+----------+-----------+------------+
| ver u8 | type u8 | sid u16be | seq u32be | len u32be |   bytes    |
+--------+---------+-----------+----------+-----------+------------+
```

`type` is `Open(0) | Data(1) | Close(2) | Control(3)`. `seq` counts frames per stream per
direction from 0; a receiver feeds sequences through a tracker that distinguishes ok,
duplicate, gap and reorder. `MAX_PAYLOAD` is 1 MiB. Version mismatch, unknown type, oversized
declared length and truncation are distinct decode errors. Truncation is only detectable when a
transport ends with bytes still buffered, so the decoder exposes an explicit finish step that
reports it; a connection that dies mid-frame must not look like a connection that went quiet.

Either side may open a stream, so stream ids are partitioned by role to keep two simultaneous
opens from colliding: the side that dialled uses odd ids, the side that accepted uses even ones.

Closing a connection reaps every stream on it, and from that moment the muxer is deaf: inbound
frames are dropped and an `Open` is refused with `connection is closed`. That matters because a
transport is not dead the moment this side is finished with it — a graceful WebSocket close is a
handshake the far end can decline, and `ws` keeps delivering frames for the whole of its 30s
close timeout while it waits for an answer. `Open` is the frame whose effect outlives the
connection, since it spawns a process, so it is refused in its own right as well.

### The `Open` payload

`Open`'s payload is UTF-8 and carries the stream name plus whatever that stream needs to start:

- A payload beginning with `{` is a JSON object whose `name` is the stream name and whose
  remaining fields are that stream's open parameters.
- Any other payload is the bare stream name, which is the host-poc form and stays valid.

One frame rather than a name followed by a parameter frame, because a stream whose parameters are
optional — `pty` with no `argv` — would otherwise leave the handler unable to tell an absent
parameter frame from the first byte of input. Handlers get everything they need at open time.

Capabilities are advertised in the descriptor and in the handshake, so new stream names are
additive: a caller checks the capability before opening. Current names: `pty`, `pty:<program>`,
`exec`, `msg`.

## Liveness

A transport that ends politely — a process exiting, a `close()` — reaches every layer above
it at once: the kernel sends a FIN and `onClose` fires. A machine that is switched off,
suspended, unplugged or frozen mid-syscall sends nothing at all, and the socket stays
ESTABLISHED on this side for as long as nothing writes to it. Everything downstream trusts
`ConnectionRegistry`, so that is not degradation but confident wrongness: a UI says
connected, a reachability prober skips the peer _because_ it has a connection, and the
mailbox flusher retries against a socket that can never answer. Suspending a peer's process
with `SIGSTOP` reproduces it exactly — nothing about the connection changes until the
process is actually killed.

So each side asks. Every connection, dialed or accepted, sends a WebSocket ping every **10
seconds** and destroys the transport when a ping goes unanswered for **10 seconds**. A peer
that has gone away is therefore noticed in 10–20 seconds, while a peer that merely stalls
for less than the timeout — a long GC, a loaded machine, a laptop catching up — is not
dropped at all. The interval is also well inside the idle timeout of a typical NAT, so the
pings keep the path open as a side effect.

`terminate()`, not `close()`, for the same reason revocation uses it: there is nobody there
to complete a close handshake, and `ws` would wait out its 30s close timeout first. What the
far side observes, if it ever runs again, is an abnormal closure (1006) — no close frame,
its streams reaped, its `pty` and `exec` children killed by their handlers' close paths.
Indistinguishable, deliberately, from the machine at this end going away.

Both ends run it, and the accepting side has the most to lose by not: a host whose client
vanished holds that client's shells open, their processes running and their slots in the
per-peer `pty` and `exec` budgets until the peer reconnects and `ConnectionRegistry.add`
supersedes the old connection — which for a machine that is not coming back is never.

A pong is answered by the peer's WebSocket layer, not by its application, so a pong proves
the far process is running its event loop. It does not prove the far _application_ is making
progress: one that has wedged while its event loop spins still pongs. Catching that is the
mailbox's ack timeout's business, one layer up.

**Any inbound frame answers the ping.** A pong is an ordinary WebSocket frame, written in
order behind whatever is already queued on the socket, and beam has no flow control (see the
out-of-scope table). A peer whose output outruns the link therefore answers every ping
correctly and still answers late — a remote pane filling the send buffer puts megabytes in
front of the pong — and a monitor watching only for pongs reaps a machine that is not only
alive but busy, which is worse than the failure it exists for. So a frame arriving from the
peer settles the outstanding ping and every `checkAlive` in flight, exactly as a pong does.
It is stronger evidence, not weaker: a pong proves the far `ws` layer ran, a frame proves
that _and_ that something above it wrote. It says nothing new about the peer's reading side
— a peer that writes without ever reading still looks alive here, exactly as one that pongs
without reading always did, and that boundary is still the mailbox's.

Evidence, not exemption: silence is still counted from the last thing that arrived, so a
peer whose frames stop is dropped on the ordinary bound whatever backlog preceded them.

`PeerConnection.checkAlive()` exposes the same probe as a one-shot question, for a caller
about to rely on a connection that cannot wait out the periodic timer — the desktop's
reconnect path asks it before deciding whether to redial through the connection it already
has. A transport with no probe of its own gets no monitor and answers `checkAlive` with
`false`: `TransportSocket.ping`/`onPong` are optional, and an unverifiable connection is
reported as suspect rather than as healthy.

## Streams

### `pty`, `pty:<program>`

A real terminal, `node-pty` on Node. Open parameters:
`{ name: "pty", argv?: string[], cwd?: string, env?: Record<string,string>, cols?, rows? }`.
An absent or empty `argv` means the login shell (`$SHELL`, else bash, else sh); otherwise
`argv[0]` is executed directly, with no shell and no word splitting of the remaining arguments.
The bare name `pty:<program>` stays valid and is equivalent to `argv: ["<program>"]`.

A remote session needs all of those: attaching a tmux client is
`tmux -u -S <socket> attach-session -t =name:`, which is an argv, a cwd and a size, not a program
name.

`Control` `{ kind: "resize", streamId, cols, rows }` resizes, clamped to 2–500 in both axes
because the numbers come from the far side. Closing the stream kills the process; the process
exiting closes the stream with a reason. A cap of 32 live PTYs **per peer**, not per
connection and not across the node: a peer that opens its full allowance must not shrink
another peer's, and one that reconnects must not find its own budget already spent.

### `exec`

The `ssh host cmd` contract: run an argv, pipe stdin, get stdout, stderr and an exit code.
This is what lets a caller run `git` and `tmux` on the far machine without beam knowing what
those commands mean.

Open parameters: `{ name: "exec", argv: string[], cwd?: string, env?: Record<string,string> }`.
`argv[0]` is executed directly — no shell, no word splitting. Provided `env` entries are merged
over the host's environment, not replacing it.

A cap of 32 live `exec` children per peer, the same budget and the same per-peer reasoning as
`pty`'s: `exec` spawns a real child process per stream, so an uncapped peer could run the
machine out of processes.

`cwd` must be absolute or start with `~/`, and a leading `~/` is expanded **by the accepting
machine**, against the home directory of the user the node runs as. Because there is no shell
anywhere in this path, a caller cannot expand it and a `~` appearing anywhere else in an argument
is a literal character. That is why callers that need a remote home-relative directory pass it as
`cwd` rather than as an argument such as `git -C ~/repo`, which would never resolve.

Data frames on an exec stream carry a one-byte channel prefix: `0` stdin (client→host), `1`
stdout, `2` stderr (host→client). The prefix is local to the exec handler; the muxer stays
payload-agnostic. `Close` from the host carries `{ exitCode, signal }`. Closing from the
client kills the process group.

End of stdin is a `Control` message `{ kind: "stdin-eof" }`, not a zero-length data frame: it is
unambiguous, and `Control` is already the channel acks use. The host guards writes after end and
keeps an `'error'` listener on the child's streams regardless — an unhandled stream `'error'`
anywhere in a node is a remote crash, since the far side chooses what it sends and when.

### `msg`

Carries mailbox envelopes (below). Either side may open it, because either side may send.

## Durable mailbox

A message is an opaque payload addressed to a peer. beam never parses `payload`; `topic`
exists so a receiver can subscribe to what concerns it.

```ts
interface Envelope {
  id: string; // uuid
  from: string; // sender peerId
  to: string; // recipient peerId
  seq: number; // monotonic per sender, strictly increasing
  topic: string; // free-form, e.g. "orchestra"
  payload: string; // utf8 or base64 per `encoding`
  encoding: 'utf8' | 'base64';
  createdAt: number;
}
```

Payload cap 256 KiB, measured on the decoded payload. That is not on its own enough to
guarantee the envelope fits one frame: the wire form is `JSON.stringify(envelope)` and JSON
escaping is not size-preserving — a control character is one byte of utf8 and six of JSON
(`\u0001`). Both caps are therefore checked, the payload's and the serialized envelope's
against `MAX_PAYLOAD`, and on both sides: `send()` refuses an envelope that would not encode
rather than queuing one the flusher could never drain, and a receiver refuses one over the
cap rather than storing past it. An envelope already on disk that cannot be encoded is
quarantined like any other message that can never be sent, so it does not sit at the head of
the queue blocking everything behind it.

**One queue per peer, not per role.** Each node keeps `mailbox/out/<peerId>/`, one file per
undelivered message, written to a temp file and then linked into place — an exclusive create,
which fails rather than replacing an existing destination, so a same-seq collision is always
a loud error and never a queued envelope that silently disappeared. The file is named by
zero-padded `seq` so the directory sorts into send order. A message is unlinked only when the recipient acknowledges it.
Whenever a live connection to that peer exists — **whichever side dialed** — the flusher
drains that queue in order over a `msg` stream. This single mechanism serves both directions,
which is why a player on a worker box can report to an orchestrator on a laptop that the
worker box cannot dial.

**Delivery.** Strictly sequential: send one envelope, wait for its ack, unlink, continue. The
receiver persists the highest accepted `seq` per sender in `mailbox/seen/<peerId>.json`,
accepts any `seq` above it, and re-acks without re-delivering anything at or below it — which is
the duplicate a crash between delivery and ack produces. At-least-once on the wire plus that
dedup means the receiving application sees each message exactly once, in sender order.

The receiver deliberately does **not** require `seq == last + 1`. Ordering does not come from
contiguity: it comes from the sender draining its queue strictly sequentially over an ordered
transport, so the receiver cannot observe reordering in the first place. Requiring contiguity would
only add _detection_ of a sender-side loss — which the sender already knows about, and is the side
that can report it — at the cost of a receiver that wedges permanently on a hole it can never fill.

`seq` counts per **(sender, recipient) pair**, not per node: the receiver's dedup is per sender, so
a node-wide counter would present each of its peers a sequence full of holes. The counter lives in
`mailbox/seq.json`, keyed by recipient.

Acks are `Control` `{ kind: "ack", id, accepted: true|false, reason? }`.

**Both ends are durable, and the two acknowledgements mean different things.** A receiving node
writes the envelope to `mailbox/in/<peerId>/` before acknowledging it on the wire, and unlinks it
only when a subscriber acknowledges having taken it. Anything still there at start-up is
redelivered.

| Acknowledgement                   | Means                                | Effect                                              |
| --------------------------------- | ------------------------------------ | --------------------------------------------------- |
| wire ack, to the sender           | the receiving machine has it on disk | the sender unlinks its copy and reports `delivered` |
| subscriber ack, to the local node | an application has taken it          | the receiver unlinks its copy                       |

Without the inbound store, `delivered` would mean only that a process somewhere had the message in
memory: killing the receiver would lose it, and a resend would be refused as a duplicate because the
receiver's `seen/` had already advanced. A subscriber that crashes, exits, or never attaches must
lose nothing, which is exactly what a relay delivering into a terminal needs.

The alternative — withholding the wire ack until a subscriber takes the message — would make
`delivered` depend on a consumer being attached at that instant, and would leave the sender retrying
against a machine that already has the message.

**Flush triggers**: a connection to the peer becoming live (either direction), node start,
and a retry while a connection stays up. The retry is bounded by the connection, not by a
count: an envelope that is not acked is sent again every 2 seconds for as long as the
connection lasts. Liveness is what bounds that in turn — a peer that stops answering has its
transport destroyed within the ping timeout, the drain loop then finds no connection and
stops, and the envelope stays queued for the next one. No timers are needed for offline
peers — there is nothing to try.

**A lost counter with an empty backlog is the one hole left.** `SeqCounter` reconciles every
`next()` against the highest seq already on that peer's own disk, so a counter file that is
lost while messages are still queued cannot reissue a number this node already wrote down.
A seq already delivered and unlinked leaves no such trace. If `mailbox/seq.json` is lost at a
moment when that peer's queue happens to be empty, numbering restarts at 1 — numbers the
receiver has already accepted. The next real message is then judged a duplicate, acked, and
reported `delivered` without ever reaching an application. Nothing in local state can
distinguish that case; closing it needs the receiver's own high-water mark, which nothing
asks for today.

**A queue file that cannot be read is a lost message, and is reported as one.** It is quarantined
rather than retried forever, and the loss is surfaced — an event, an entry in the queue listing, a
warning. This matters because `send()` already returned `queued` for that message, so the sender was
told it was durable. Silently continuing would make the one promise this mailbox exists to keep a
lie. A counter or dedup file that cannot be read is different: those are refused outright rather
than reset, because a sequence number that restarts causes the receiver to judge real messages as
duplicates, ack them, and let the sender report `delivered` for mail that will never arrive.

### Send outcomes

`send()` resolves to one of three outcomes, and the distinction is user-visible:

| Outcome     | Meaning                                                                     | Caller behaviour             |
| ----------- | --------------------------------------------------------------------------- | ---------------------------- |
| `delivered` | the recipient acked                                                         | done                         |
| `queued`    | no live connection, or no ack before the timeout; the envelope is persisted | **success** — do not resend  |
| `rejected`  | unknown or revoked peer, bad payload or topic, queue full, failed write     | failure — nothing was stored |

`queued` is a success because the message is durable. Anything that reports to a human or an
agent must say so in those terms, so the sender does not sit waiting for a reply that cannot
come yet or, worse, send it again:

```
queued for workbox — that machine is not connected right now. beam will deliver this
message the next time it comes online. Do not send it again.
```

`rejected` must name which cause applied. `queue-full` means this peer's queue is at its
depth or byte bound; like `storage-failure`, nothing was stored and the caller may retry.
`invalid-topic` means the topic failed the boundary check above. A queue write that fails — a full or
read-only disk, a permission problem — is `storage-failure`: nothing was stored, so
unlike `queued` the caller was promised nothing and may retry. A sequence number is
claimed only once the envelope is on disk, so a failed write leaves no gap behind it.

### Local IPC

While a node runs it listens on `$BEAM_DIR/run/inbox.sock` (mode `0600`), so any process on
that machine can send and receive without holding the identity itself. Requests and responses
are line-delimited JSON:

```
{"op":"send","to":"<peerId|label>","topic":"orchestra","payload":"…","encoding":"utf8"}
  → {"status":"queued","to":"<peerId>","label":"workbox","queueDepth":2,"reason":"peer not connected"}
{"op":"subscribe","topic":"orchestra","from":["<peerId>",…]}
  → one envelope per line (see acknowledgement below); both `topic` and `from` are optional
    filters, applied server-side — an envelope neither wants is left for another subscriber,
    never acked-and-discarded by this one
{"op":"status"}                             → { peers, bindAddress }
{"op":"revoke","peer":"<peerId>"}           → { status: "ok" } | { status: "error", reason }
{"op":"rename","peer":"<peerId>","label":"<label>"}
  → { status: "ok", label: "<resolved label>" } | { status: "error", reason }
{"op":"forget","peer":"<peerId>"}           → { status: "ok" } | { status: "error", reason }
{"op":"reload-peers"}                       → { status: "ok" }
```

One request line is capped at 1 MiB; a client that sends more than that without a newline has
its connection dropped, so no local process can grow the node's heap by never terminating a
line.

**Exactly one node writes a given `$BEAM_DIR` at a time.** There is no lockfile; the
guarantee rests on the operator running one node per directory, and the queues are built so a
violation is loud rather than silent — an exclusive create on every queue file, and a
sequence counter reconciled against what is already on disk. Two nodes sharing a `$BEAM_DIR`
is a misconfiguration, not a supported mode. A one-shot dial (`exec`, `connect`) that starts
its own ephemeral node is only safe against a `$BEAM_DIR` no other node is running in.

Both queues are bounded per peer: at most 10,000 envelopes and 64 MiB for any one peer,
outbound and inbound alike. A `send()` past the bound is `rejected` with `queue-full` and
stores nothing; an inbound envelope past it is refused rather than stored, so it stays in the
sender's queue where the sender can still account for it. Without the bounds, one peer that
is offline for a week — or one whose subscriber never attaches — fills the disk that this
node's own mail lives on.

One node per `$BEAM_DIR`. A CLI that needs an existing node's connections (`msg send` from a
script, `msg listen` beside a running node) uses this socket; a one-shot dial (`exec`,
`connect`) may start its own ephemeral node instead. Because dedup state is shared through
`$BEAM_DIR`, a second node cannot cause double delivery.

`revoke`/`rename`/`forget` apply directly to the running node's live `PeerTable` — the same
instance its `Host` and `Mailbox` already hold — so the change is visible to auth and delivery
immediately, not only after a restart re-reads `peers.json`; `revoke` also drops that peer's
live connection. `reload-peers` re-reads `peers.json` from disk, for the one case that writes it
from a _different_ process: `pair` running as a separate CLI invocation, or a `revoke` that
fell back to the file because no node answered. It then drops the live connection of every
peer the reload found revoked or gone, for the same reason `revoke` does: a revocation that
leaves an already-open connection and its running shells up is not one.

Every revocation path — `Host.revoke`, and `revoke`, `forget` and `reload-peers` over this
socket — _terminates_ the connection rather than closing it gracefully. A graceful close is a
request the peer has to agree to, and a peer that has just lost access is the one with a reason
to refuse: `ws` would then hold the socket open for its 30s close timeout, delivering that
peer's frames the whole time. Terminating destroys the transport on the spot. An ordinary
shutdown — `Host.close()`, or a peer's new connection superseding its old one — still closes
politely. A CLI command prefers
this socket and falls back to writing `peers.json` directly only when no node answers.

#### Acknowledging a subscription

A subscriber acknowledges each envelope by id, after it has done something durable with it. One
that fails, crashes or exits without acking leaves the envelope unacknowledged, so it stays in the
sender's queue and is redelivered later. In the library, a handler returning successfully is that
acknowledgement; over the socket and in the CLI it is explicit.

There is deliberately no acknowledge-on-receipt mode. A relay that acks on receipt and then fails
to deliver has destroyed a message the sender was already told would arrive — worse than the
`queued` case the mailbox exists to make safe, because the sender has no reason to doubt it. A
consumer that merely observes (a status board, a log) is free to ack immediately; it just has to
say so by acking.

#### The desktop is a mailbox subscriber

Under a plain terminal, Orchestra's `relay.sh` is the subscriber. Under N10 Desktop it is the
desktop itself (`apps/desktop/src/main/beam-node-mail.ts`'s `InboundMailSubscriber`, built on
`Mailbox.subscribeInbound` rather than `onMessage`): the desktop already owns the tmux sessions a
report needs to land in, so it is the one thing in a position to ack honestly. Its subscriber ack
means "this pane received the text", not "a process took delivery of the bytes" — `subscribeInbound`
holds each envelope's `acknowledge()` open across a utility-process hop to the main process, which
resolves a target against local state (D14, below) and injects into the pane
(`apps/desktop/src/main/beam-mail-relay.ts`), and only a successful injection acks. A refusal or a
target with no live connection never acks: the envelope stays in `mailbox/in/`, visible in the
machines panel as waiting or refused, exactly as durable as it was before the desktop read it.

Because `subscribeInbound` replays its backlog synchronously, inside `Mailbox`'s call, before any
caller-side listener can be attached, `InboundMailSubscriber.onMail` replays whatever it still
holds unacked to a listener that attaches after construction — otherwise a restart's backlog would
be handed to zero listeners and silently lost, defeating the "anything still there at start-up is
redelivered" guarantee above one layer up.

### Injected environment

Processes started by the host for a `pty` or `exec` stream get:

| Variable            | Meaning                                    |
| ------------------- | ------------------------------------------ |
| `BEAM_DIR`          | config directory in use                    |
| `BEAM_INBOX`        | path to the local IPC socket               |
| `BEAM_PEER_ID`      | this machine's id                          |
| `BEAM_CALLER_ID`    | the peer that opened the stream            |
| `BEAM_CALLER_LABEL` | that peer's label as this machine knows it |

A script that beam started can therefore answer the machine that started it without being
configured, which is how `report.sh` finds its way home.

## Identity scoping across machines

Every id belongs to the machine it lives on: tmux session names, worktree paths, pane ids,
n10 registry keys. Two machines may hold the same branch, the same worktree path and the same
session label. A target that crosses machines is written `beam:<peer>/<local target>` where
the local part is whatever the receiving side understands (`tmux:<session>`,
`codex:<thread-id>`). Registry keys in `libs/core` gain a machine segment whose local value is
`local`, so existing local behaviour is unchanged and remote entries cannot collide with it.

## Security posture

- Pairing grants a shell as the user running the node. `exec` adds no privilege a `pty` stream
  did not already give. Treat pairing like granting SSH access; `beam revoke` takes it back
  immediately, and a revoked peer fails authentication rather than being silently ignored.
  Immediately means the transport is destroyed, not asked to close, and the muxer stops
  serving frames the moment the connection is reaped — a revoked peer gets no window in which
  to open one more shell.
- The WebSocket transport is not encrypted. WebRTC data channels are (DTLS). Mutual
  authentication is mandatory on both, so a plain-WS network attacker can read traffic but
  cannot impersonate either side. That extends to the upgrade itself: a ticket read off the
  wire is not enough to connect, because `/ws` also requires a signature over
  `beam-ws:<ticket>` from the key the host stored at pairing. Run over Tailscale or tailcat
  when the network is not trusted.
- Default bind is loopback. Exposing the node on other interfaces requires an explicit
  `--hostname`, and the node prints what it bound.
- The pairing URL is a bearer token for its 10 minute window; anything that captures stdout
  captures it.
- A `peerId` is the first 16 hex characters — 64 bits — of the SHA-256 of the public key PEM,
  and everything that keys on identity rests on that truncation: the peer table, the
  mailbox's per-peer directories and dedup state, and which stored key the `/ws` upgrade
  verifies a proof against. 64 bits is ample against finding a second key that matches a
  _given_ peer's id, which is the attack that would matter here. It is not collision
  resistance: a party generating keys at will could find two of their own that share an id in
  around 2^32 work. What that would buy them is limited by the accepting side refusing a
  re-pair that would change a stored peer's key or endpoints without an explicit replace.
- The mailbox stores payloads unencrypted at rest, under `0600`, and never executes them. A
  relay that delivers a message into a terminal must check what owns that terminal, exactly as
  Orchestra's `pane_owned_by_agent` does today.

## Decisions

Comments throughout `libs/beam` cite decisions by number (`D1`, `D5`, …). This is the
register they point at. The numbers are beam-specific, which is why they live here and not in
`docs/decisions.md`. Each entry states the decision and the reason it was made that way; the
sections above are where the mechanics live.

| #   | Decision                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | An `Open` frame carries the stream name and its JSON parameters in one payload, never a name followed by a separate parameter frame.                                                                                                                      | A handler whose parameters are optional cannot tell an absent parameter frame from the stream's first real byte of input. The earlier form let an open payload be delivered to whatever `onData` was already wired up, as if it had been typed at the process.                                                                               |
| D2  | A counter or dedup file that cannot be read is refused rather than reset, and a queue file is created exclusively rather than renamed over.                                                                                                               | A sequence that restarts reissues a number the receiver already accepted, so the receiver acks it as the duplicate it looks like and the sender reports `delivered` for mail nobody will ever get. Silence is the failure mode this whole subsystem exists to avoid.                                                                         |
| D3  | Every child stream and every raw socket gets an `'error'` listener, even a swallowing one, every write or ioctl that can race a close is guarded, and the synchronous pre-auth `'upgrade'` handler is wrapped whole so a throw refuses that socket alone. | An EventEmitter that emits `'error'` with nobody listening throws, and an uncaught throw out of a connection whose timing any paired peer controls is a remote kill switch. A swallowing `'error'` listener does not catch a thrown exception, and the upgrade path runs before authentication, so there the caller need not even be a peer. |
| D4  | A peer with a known endpoint that has not been probed reports `unknown`, never a guessed `unreachable`.                                                                                                                                                   | No prober exists yet. A laptop that has never dialed a paired worker box is not at fault, and calling it `unreachable` reads as a live problem and invites the user to re-pair a healthy machine.                                                                                                                                            |
| D5  | The PTY and `exec` caps, and revocation, are enforced per peer rather than globally across the node.                                                                                                                                                      | One handler instance is shared by every connection, so a global cap would let one peer consume another's budget. Revocation is checked on every turn of the drain loop for the same reason: it must stop queued mail even when something closed the connection without revoking.                                                             |
| D6  | Peer reachability is a small closed set — `connected`, `reachable`, `unreachable`, `no-endpoint`, `unknown` — and `revoked` is orthogonal to it.                                                                                                          | `connected` and `no-endpoint` are answerable with certainty from what the library tracks; the rest are not, and folding `revoked` into the same field would hide a trust decision inside a reachability report.                                                                                                                              |
| D9  | A `rejected` send names who it was for as well as why, and admin ops act on the running node's live `PeerTable` rather than only on disk.                                                                                                                 | A caller told only "rejected" cannot say which peer failed, and a `revoke` that takes effect only after a restart is not a revoke. Cited interchangeably with D11 for the first half.                                                                                                                                                        |
| D11 | Same as D9's first half: a rejection carries `to` and, where one resolves, `label`.                                                                                                                                                                       | The UI has to name the peer it could not send to.                                                                                                                                                                                                                                                                                            |
| D15 | A receiving node writes an envelope to `mailbox/in/<peerId>/` before acking it on the wire, and unlinks it only once a subscriber acks.                                                                                                                   | Without the inbound store, `delivered` would mean only that some process had the message in memory: killing the receiver would lose it, and a resend would be refused as a duplicate because `seen/` had already advanced.                                                                                                                   |

Two cited numbers have no recoverable rationale and are deliberately left unstated rather
than guessed at: **D7**, cited once in `mailbox/mailbox.ts` as "decisions.md D7/D9" with no
accompanying reasoning, and **D14**, cited once in this document's desktop-subscriber
paragraph for "resolves a target against local state". D1 is also cited in the mailbox for
two further rules — the receiver's lack of a contiguity requirement, and quarantine being
loud rather than silent — both stated in full under "Durable mailbox" above.

## Deliberately out of scope, doors left open

| Later                                     | What keeps it possible                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the WebRTC transport                      | `Transport`/`TransportSocket` is the seam — `send`, `close`, `terminate`, `onData`, `onClose`, plus the optional `ping`/`onPong` pair liveness rides on, where `terminate` is the abrupt drop revocation and a silent peer both need; until one exists the descriptor omits the capability and `POST /rtc` answers 501, so a caller can tell absence from failure |
| tailcat or relayed transports             | `Transport` is an interface; `endpoints` are opaque strings                                                                                                                                                                                                                                                                                                       |
| ssh executor for Orchestra                | the scripts route every tmux and git call through one executor                                                                                                                                                                                                                                                                                                    |
| several tmux servers or sessions per host | every tmux call carries its socket path; targets have room for a server segment                                                                                                                                                                                                                                                                                   |
| agent-to-agent messaging                  | envelopes carry `from`; topics are free-form; both sides can open `msg`                                                                                                                                                                                                                                                                                           |
| publishing `libs/beam` on its own         | no n10 imports, no assumptions about the caller                                                                                                                                                                                                                                                                                                                   |
| store-and-forward for other apps          | the mailbox is addressed by peer and topic, not by Orchestra concepts                                                                                                                                                                                                                                                                                             |
| backpressure and flow control             | deliberately absent: nothing in the wire format or the stream API promises it, and `exec`'s pump bounds only this process's own read-side buffering, so a fast producer can still grow the transport's send queue. `Control` already carries per-stream messages, so a credit scheme fits without a wire-format change                                            |
