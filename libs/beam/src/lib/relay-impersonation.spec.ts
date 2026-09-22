/**
 * Three machines, not two. Every other spec here checks one exchange in
 * isolation and finds it sound; this one composes three parties, which is
 * where the handshake actually failed.
 *
 * The topology is the one docs/beam.md advertises: laptop C has no
 * inbound endpoint, so it dials. It is paired with two worker boxes, M
 * and P. M is compromised. **M and P were never paired**, and P will
 * never knowingly accept anything from M.
 *
 * With unbound signatures, M did not need to be. `GET P/challenge/C` is
 * open to anyone who names a peer P knows, and the nonce it returned was
 * bound to nobody; C signed whatever string the host it dialed called a
 * challenge. So M fetched a nonce from P in C's name, handed it to C as
 * its own, and relayed C's answer to `P/session` — arriving at P as C,
 * with a real signature by C's key, and P holding no record of M at all.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signNonce } from './auth.js';
import { dial, pair } from './client.js';
import { sessionTranscript, wsTranscript } from './handshake-transcript.js';
import { Host } from './host.js';
import { loadOrCreateIdentity, type Identity } from './identity.js';
import { PeerTable, type PeerRecord } from './peer-table.js';
import {
  startMaliciousMiddle,
  type MaliciousMiddle,
} from '../test-support/malicious-middle.js';

let dirs: string[];
/** P: the target worker box. Paired with C, and with nothing else. */
let target: Host;
/** M: a worker box C is paired with, and that has been compromised. */
let middle: MaliciousMiddle;
/** C: the laptop. No inbound endpoint; it dials both of them. */
let victim: Identity;
let victimPeers: PeerTable;
/** P as C stored it at pairing, asserted in the control test below. */
let pairedTarget: PeerRecord;

beforeEach(async () => {
  dirs = ['p', 'm', 'c'].map((n) =>
    mkdtempSync(join(tmpdir(), `beam-relay-${n}-`))
  );
  const [dirP, dirM, dirC] = dirs as [string, string, string];

  const identityP = loadOrCreateIdentity(dirP, { hostname: () => 'workbox-p' });
  target = new Host({ identity: identityP, peers: new PeerTable(dirP) });
  await target.listen();

  middle = await startMaliciousMiddle(
    loadOrCreateIdentity(dirM, { hostname: () => 'workbox-m' })
  );

  victim = loadOrCreateIdentity(dirC, { hostname: () => 'laptop-c' });
  victimPeers = new PeerTable(dirC);

  // C pairs with P for real, over the wire; the control test asserts what
  // that left behind.
  pairedTarget = (
    await pair(target.issuePairingUrl().url, victimPeers, { identity: victim })
  ).peer;

  // C's pairing with M, which M's fake HTTP surface has no route for.
  victimPeers.upsert({
    peerId: middle.identity.peerId,
    label: 'workbox-m',
    publicKeyPem: middle.identity.publicKeyPem,
    endpoints: [middle.baseUrl],
  });

  // The premise of every test below: P has never heard of M.
  if (target.peers.get(middle.identity.peerId))
    throw new Error('the target must not be paired with the middle');
});

afterEach(async () => {
  await target.close();
  await middle.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Drive one dial of the middle by the victim, and return the `/session`
 * proof the middle captured out of it. The dial succeeds: from C's side
 * this is an ordinary connection to a machine it is paired with, which is
 * exactly why nothing warns anybody. */
async function dialTheMiddle(): Promise<{
  peerId: string;
  challenge: string;
  signature: string;
}> {
  const connection = await dial(middle.baseUrl, middle.identity.peerId, {
    identity: victim,
    peers: victimPeers,
    liveness: false,
  });
  connection.close();
  const captured = middle.captured.at(-1);
  if (!captured) throw new Error('the middle captured no session proof');
  return captured;
}

/** Whether the target accepts a `/ws` upgrade with this ticket and proof. */
function upgrades(ticket: string, proof: string): Promise<boolean> {
  const url = new URL(`ws://${target.hostname}:${target.port}/ws`);
  url.searchParams.set('ticket', ticket);
  url.searchParams.set('proof', proof);
  return new Promise((resolve) => {
    const socket = new WebSocket(url.toString());
    socket.once('open', () => {
      socket.close();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** A live, unspent ticket the target genuinely issued to the victim. */
async function ticketForVictim(): Promise<string> {
  const { challenge } = (await (
    await fetch(`${target.baseUrl}/challenge/${victim.peerId}`)
  ).json()) as { challenge: string };
  const parties = {
    hostPeerId: target.identity.peerId,
    clientPeerId: victim.peerId,
  };
  const res = await fetch(`${target.baseUrl}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      peerId: victim.peerId,
      challenge,
      signature: signNonce(
        victim.privateKeyPem,
        sessionTranscript(parties, challenge)
      ),
      clientChallenge: 'c-nonce',
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { ticket: string }).ticket;
}

describe('a compromised middle cannot relay the victim it is paired with', () => {
  it('cannot spend C’s signature over P’s nonce at P', async () => {
    // 1. M asks P for a nonce in C's name. P answers: C is a peer of P,
    //    and this route asks nothing else of the caller.
    const relayedRes = await fetch(
      `${target.baseUrl}/challenge/${victim.peerId}`
    );
    expect(relayedRes.status).toBe(200);
    const { challenge } = (await relayedRes.json()) as { challenge: string };

    // 2. M hands that nonce to C as its own challenge, and C signs it.
    middle.stage(challenge);
    const stolen = await dialTheMiddle();
    expect(stolen.peerId).toBe(victim.peerId);
    expect(stolen.challenge).toBe(challenge);

    // 3. M relays C's real signature over P's real nonce to P/session.
    const relay = await fetch(`${target.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: stolen.peerId,
        challenge: stolen.challenge,
        signature: stolen.signature,
        clientChallenge: 'm-nonce',
      }),
    });

    // Unbound, this returned 200 and a ticket for C. The signature is over
    // a transcript naming M as the host, so at P it verifies against
    // nothing.
    expect(relay.status).toBe(401);
    expect(await relay.json()).toEqual({ error: 'bad-signature' });
    expect(target.connections.get(victim.peerId)).toBeUndefined();
  });

  it('cannot turn C into a signing oracle for a P ticket', async () => {
    // The second half of the same attack, and the standing regression
    // guard for context separation: suppose M has a live ticket P issued
    // to C — off the wire, or from the relay above before it was closed.
    // A ticket is not authorisation on its own; `/ws` also wants C's
    // signature over it. So M drops C's connection, waits for the
    // reconnect, and hands C the exact string that proof has to be.
    const ticket = await ticketForVictim();
    const parties = {
      hostPeerId: target.identity.peerId,
      clientPeerId: victim.peerId,
    };
    middle.stage(wsTranscript(parties, ticket));
    const stolen = await dialTheMiddle();

    expect(await upgrades(ticket, stolen.signature)).toBe(false);
    // ...and the refusal did not burn the ticket: C's own upgrade still
    // works, so the attempt is not even a denial of service.
    expect(
      await upgrades(
        ticket,
        signNonce(victim.privateKeyPem, wsTranscript(parties, ticket))
      )
    ).toBe(true);
  });

  it('refuses a nonce P minted for one peer when another presents it', async () => {
    // The same fungibility one layer down, between two peers P does know.
    const other = loadOrCreateIdentity(
      mkdtempSync(join(tmpdir(), 'beam-relay-o-')),
      { hostname: () => 'other' }
    );
    target.peers.upsert({
      peerId: other.peerId,
      label: 'other',
      publicKeyPem: other.publicKeyPem,
      endpoints: [],
    });
    const { challenge } = (await (
      await fetch(`${target.baseUrl}/challenge/${victim.peerId}`)
    ).json()) as { challenge: string };

    const res = await fetch(`${target.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: other.peerId,
        challenge,
        signature: signNonce(
          other.privateKeyPem,
          sessionTranscript(
            {
              hostPeerId: target.identity.peerId,
              clientPeerId: other.peerId,
            },
            challenge
          )
        ),
        clientChallenge: 'x',
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'stale-challenge' });
  });

  it('still lets C pair with and dial P, the control every refusal needs', async () => {
    // Pairing is symmetric and really happened: both tables hold the
    // other's key, and P's id is the one C derived for itself.
    expect(pairedTarget.peerId).toBe(target.identity.peerId);
    expect(target.peers.get(victim.peerId)?.publicKeyPem).toBe(
      victim.publicKeyPem
    );

    const connection = await dial(target.baseUrl, target.identity.peerId, {
      identity: victim,
      peers: victimPeers,
      liveness: false,
    });
    expect(connection.peerId).toBe(target.identity.peerId);
    expect(target.connections.get(victim.peerId)).toBeDefined();
    connection.close();
  });
});
