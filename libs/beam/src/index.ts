/**
 * @n10/beam — pairs two machines and streams terminals and commands between
 * them. See docs/beam.md at the repository root for the full spec.
 *
 * This is Phase 1: identity, the peer table, the frame protocol, mutual
 * auth, the host's HTTP + WebSocket surface, the client's pair/dial flow,
 * and a `pty` stream handler backed by node-pty. The `exec` and `msg`
 * streams and the durable mailbox are later phases; the stream registry and
 * PeerConnection interface here are the seam they land on.
 */

export { resolveBeamDir, type BeamDirEnv } from './lib/beam-dir.js';

export {
  isLabel,
  isPeerId,
  isTopic,
  MAX_LABEL_LENGTH,
  MAX_TOPIC_LENGTH,
} from './lib/identifiers.js';

export {
  derivePeerId,
  loadOrCreateIdentity,
  renameIdentity,
  type Identity,
  type LoadOrCreateIdentityOptions,
} from './lib/identity.js';

export {
  PeerTable,
  type NewPeer,
  type PeerRecord,
  type PeerTableOptions,
} from './lib/peer-table.js';

export {
  FIRST_SEQ,
  FRAME_HEADER_SIZE,
  FRAME_VERSION,
  FrameDecoder,
  FrameType,
  MAX_PAYLOAD,
  ProtocolError,
  SeqSender,
  SeqTracker,
  decodeControl,
  decodeText,
  encodeControl,
  encodeFrame,
  encodeText,
  type Frame,
  type FrameTypeValue,
  type ProtocolErrorKind,
  type SeqVerdict,
} from './lib/protocol.js';

export {
  CHALLENGE_TTL_MS,
  PAIRING_TOKEN_TTL_MS,
  TICKET_TTL_MS,
  SingleUseSecrets,
  randomSecret,
  type ConsumeResult,
} from './lib/secrets.js';

export {
  AuthError,
  MutualAuth,
  signNonce,
  verifyHostSignature,
  verifySignature,
  type AuthErrorKind,
  type MutualAuthOptions,
  type SessionProof,
  type SessionResult,
} from './lib/auth.js';

export {
  hostTranscript,
  sessionTranscript,
  wsTranscript,
  HOST_CONTEXT,
  SESSION_CONTEXT,
  WS_CONTEXT,
  type HandshakeParties,
} from './lib/handshake-transcript.js';

export type { BeamStream, StreamSink } from './lib/stream.js';
export {
  StreamRegistry,
  type StreamOpenHandler,
} from './lib/stream-registry.js';
export { Muxer, type MuxerOptions, type MuxerRole } from './lib/muxer.js';

export {
  WebSocketTransport,
  wrapWebSocket,
  type Transport,
  type TransportSocket,
} from './lib/transport.js';

export {
  DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PONG_TIMEOUT_MS,
  startLiveness,
  type LivenessMonitor,
  type LivenessOptions,
  type LivenessProbe,
} from './lib/liveness.js';

export {
  createConnection,
  type CreateConnectionOptions,
  type PeerConnection,
} from './lib/connection.js';
export { ConnectionRegistry } from './lib/connection-registry.js';

export {
  createPtyStreamHandler,
  shellForEnv,
  MAX_PTY_SESSIONS,
} from './lib/pty-handler.js';

export {
  createExecStreamHandler,
  decodeExecExit,
  demuxExecData,
  encodeExecExit,
  prefixChannel,
  EXEC_CHANNEL_STDERR,
  EXEC_CHANNEL_STDIN,
  EXEC_CHANNEL_STDOUT,
  type ExecExit,
} from './lib/exec-handler.js';

export type { NodeEnvContext } from './lib/injected-env.js';
export type { CwdResult } from './lib/resolve-cwd.js';
export type { StreamContext } from './lib/stream.js';

export {
  MAX_PAYLOAD_BYTES,
  isEnvelope,
  payloadByteLength,
  type Envelope,
} from './lib/mailbox/envelope.js';
export {
  OutboundQueue,
  type QuarantinedFile,
  type QueuedEnvelope,
} from './lib/mailbox/outbound-queue.js';
export { InboundStore } from './lib/mailbox/inbound-store.js';
export { SeqCounter } from './lib/mailbox/seq-counter.js';
export {
  MailboxCorruptionError,
  SeenTracker,
  type AcceptVerdict,
} from './lib/mailbox/seen-tracker.js';
export { derivePeerState, type PeerState } from './lib/mailbox/peer-state.js';
export { Flusher, type FlusherOptions } from './lib/mailbox/flusher.js';
export {
  Mailbox,
  type InboundHandler,
  type MailboxOptions,
  type PeerStatus,
  type QueuedForPeer,
  type RejectReason,
  type SendInput,
  type SendOutcome,
} from './lib/mailbox/mailbox.js';

export { IpcSocket, type IpcSocketOptions } from './lib/ipc-socket.js';

export {
  DESCRIPTOR_PATH,
  Host,
  PROTOCOL_VERSION,
  type HostDescriptor,
  type HostOptions,
} from './lib/host.js';

export {
  DEFAULT_DIAL_TIMEOUT_MS,
  dial,
  DialTimeoutError,
  fetchDescriptor,
  pair,
  parsePairUrl,
  PeerKeyMismatchError,
  RepairRefusedError,
  type DialOptions,
  type PairOptions,
  type PairResult,
} from './lib/client.js';
