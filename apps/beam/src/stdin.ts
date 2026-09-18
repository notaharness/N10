import type { ReadableLike } from './io.js';

/** Read all of stdin as UTF-8 text — used by `msg send`'s `-`/default
 * payload source. */
export function readAllStdin(stdin: ReadableLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk) => {
      chunks.push(
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      );
    });
    stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stdin.on('error', reject);
  });
}
