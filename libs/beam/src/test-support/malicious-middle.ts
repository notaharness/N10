/**
 * A host that a victim is legitimately paired with, and that abuses the
 * dial for something other than answering it.
 *
 * Nothing else in the suite can express this. `hostile-peer.ts` covers a
 * peer that is *present but not answering*; a real `Host` only ever
 * behaves. The composition this exists for is neither: a paired machine
 * that answers the handshake correctly from the victim's point of view,
 * while using what the victim signs somewhere else entirely. Every step
 * it takes is one a paired peer is allowed to take — which is why two
 * audits of the individual steps found nothing.
 *
 * It speaks exactly the four things `client.ts`'s `dial()` asks for:
 * `GET /challenge/:peerId`, `POST /session`, the `/ws` upgrade, and
 * nothing else. `challenge` is whatever the test staged rather than a
 * nonce of its own, and every `/session` body is recorded rather than
 * merely answered, so a test can take the victim's signature and try it
 * on a third machine.
 */

import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import { signNonce } from '../lib/auth.js';
import { hostTranscript } from '../lib/handshake-transcript.js';
import type { Identity } from '../lib/identity.js';

/** A `/session` body as it arrived from the victim. */
export interface CapturedProof {
  peerId: string;
  challenge: string;
  signature: string;
  clientChallenge: string;
}

export interface MaliciousMiddle {
  baseUrl: string;
  identity: Identity;
  /** What the next `GET /challenge/:peerId` answers with. A challenge is
   * an opaque string to the caller, so a middle is free to hand over one
   * it obtained anywhere — that is the whole of the trick. */
  stage(challenge: string): void;
  /** Every `/session` body a victim posted here, in order. */
  captured: CapturedProof[];
  close(): Promise<void>;
}

export function startMaliciousMiddle(
  identity: Identity
): Promise<MaliciousMiddle> {
  const captured: CapturedProof[] = [];
  let staged = 'unstaged-challenge';
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname.startsWith('/challenge/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ challenge: staged }));
      return;
    }
    if (url.pathname === '/session') {
      void readSession(req).then((proof) => {
        captured.push(proof);
        // Answered well enough that the victim's dial completes and it
        // notices nothing: the host signature is this machine's own, over
        // the transcript naming itself and the caller, which it is
        // perfectly entitled to produce. The ticket is never used.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ticket: 'middle-ticket',
            hostSignature: signNonce(
              identity.privateKeyPem,
              hostTranscript(
                {
                  hostPeerId: identity.peerId,
                  clientPeerId: proof.peerId,
                },
                proof.clientChallenge
              )
            ),
          })
        );
      });
      return;
    }
    res.writeHead(404).end();
  });

  // Accepts any upgrade at all: the victim must see an ordinary,
  // working connection to the machine it dialed.
  server.on('upgrade', (req, socket, head) => {
    (socket as Socket).on('error', () => undefined);
    wss.handleUpgrade(req, socket as Socket, head, () => undefined);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'string' ? 0 : address?.port ?? 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        identity,
        captured,
        stage: (challenge) => {
          staged = challenge;
        },
        close: () => closeServer(server, wss),
      });
    });
  });
}

function readSession(req: {
  on: (event: string, listener: (chunk?: Buffer) => void) => unknown;
}): Promise<CapturedProof> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () =>
      resolve(
        JSON.parse(Buffer.concat(chunks).toString('utf8')) as CapturedProof
      )
    );
  });
}

function closeServer(server: Server, wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
