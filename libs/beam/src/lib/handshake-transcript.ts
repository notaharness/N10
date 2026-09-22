/**
 * What a beam handshake signature actually covers.
 *
 * Every signature in the handshake used to be over an opaque string the
 * far side chose: `/session` signed the host's challenge bare, the host
 * signed the caller's `clientChallenge` bare, and `/ws` signed the ticket
 * behind a single `beam-ws:` prefix. Two of the three named neither the
 * context nor the parties, which made every paired peer a signing oracle
 * over arbitrary bytes for anyone it dials. A malicious middle M that a
 * victim C is paired with could hand C a nonce it had just fetched from a
 * third host P, and relay C's signature to `P/session` to be issued a
 * ticket in C's name — P and M never having been paired at all. Nothing
 * in the signature said which host the proof was for.
 *
 * So every signature is over a transcript instead: a context tag, then
 * both parties, then the value being proved fresh.
 *
 *     <context>:<hostPeerId>:<clientPeerId>:<payload>
 *
 * `hostPeerId` is always the accepting machine — the one whose HTTP
 * surface is being dialed — and `clientPeerId` always the dialing one,
 * whichever direction the signature travels in. A signature produced for
 * one host therefore does not verify at another, one produced for one
 * peer does not verify for another, and one produced in one context does
 * not verify in a different one.
 *
 * The `:` join is unambiguous rather than merely conventional, and that
 * rests on the shape of the fields, not on good behaviour: a `peerId` is
 * exactly 16 lowercase hex characters (`identifiers.ts`), so neither of
 * the two variable-position fields can contain a separator, and the one
 * field that could — `payload` — is last, where nothing follows it to be
 * confused with. Both ids are therefore *asserted* here rather than
 * assumed: `PeerTable.load` does not re-validate what it reads back from
 * `peers.json`, so a hand-edited or corrupted record is the one way a
 * peerId carrying a `:` could reach this code. It throws rather than
 * minting an ambiguous transcript.
 *
 * See docs/beam.md's HTTP surface for the protocol this backs.
 */

import { assertPeerId } from './identifiers.js';

/** The two machines a handshake signature is bound to. `hostPeerId` is
 * the accepting side and `clientPeerId` the dialing side — fixed by role
 * in the exchange, not by who is signing, so both directions of the
 * mutual proof name the same pair in the same order. */
export interface HandshakeParties {
  hostPeerId: string;
  clientPeerId: string;
}

/** Client's proof to `POST /session`, over the host's challenge nonce. */
export const SESSION_CONTEXT = 'beam-session';

/** Host's proof in the `/session` response, over the client's own nonce.
 * The client checks it against the public key it stored at pairing, which
 * is what stops it completing a handshake with an impostor. */
export const HOST_CONTEXT = 'beam-host';

/** Client's proof on the `GET /ws` upgrade, over the session ticket. The
 * transport is not encrypted, so the ticket travels where anyone on the
 * path can read it; the proof is what possession of it does not buy. */
export const WS_CONTEXT = 'beam-ws';

function transcript(
  context: string,
  parties: HandshakeParties,
  payload: string
): string {
  const host = assertPeerId(parties.hostPeerId, 'hostPeerId');
  const client = assertPeerId(parties.clientPeerId, 'clientPeerId');
  return `${context}:${host}:${client}:${payload}`;
}

export function sessionTranscript(
  parties: HandshakeParties,
  challenge: string
): string {
  return transcript(SESSION_CONTEXT, parties, challenge);
}

export function hostTranscript(
  parties: HandshakeParties,
  clientChallenge: string
): string {
  return transcript(HOST_CONTEXT, parties, clientChallenge);
}

export function wsTranscript(
  parties: HandshakeParties,
  ticket: string
): string {
  return transcript(WS_CONTEXT, parties, ticket);
}
