/**
 * Small helpers for the host's JSON-over-HTTP routes: authentication only,
 * no payload ever travels this way, so bodies are capped at 64 KiB.
 * See docs/beam.md.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export const MAX_BODY_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** Read and JSON-parse a request body, enforcing MAX_BODY_BYTES. An empty
 * body parses as `{}` so routes never have to special-case it. */
export function readJsonBody(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    // Deliberately does not destroy the socket on overflow: killing the
    // connection mid-body means the client never sees the 413 the route
    // is about to send — it just observes the socket reset.
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) {
        settle(() => reject(new BodyTooLargeError()));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      settle(() => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length === 0) {
          resolve({});
          return;
        }
        try {
          const parsed: unknown = JSON.parse(raw);
          resolve(
            typeof parsed === 'object' && parsed !== null
              ? (parsed as Record<string, unknown>)
              : {}
          );
        } catch {
          reject(new SyntaxError('malformed JSON body'));
        }
      });
    });
    req.on('error', (error) => settle(() => reject(error)));
  });
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
