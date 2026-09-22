/**
 * Name -> handler registry for incoming streams, shared by the host and the
 * client so a later phase can register `exec` or `msg` without editing
 * either. See docs/beam.md.
 */

import type { BeamStream } from './stream.js';

/** Called once when a stream this side did not open becomes ready. */
export type StreamOpenHandler = (stream: BeamStream) => void;

export class StreamRegistry {
  private handlers = new Map<string, StreamOpenHandler>();

  /** Register the handler for `name`. A name containing no colon also
   * answers `<name>:<anything>` (e.g. registering "pty" also matches
   * "pty:bash"), matching the `pty`/`pty:<program>` stream-name contract. */
  register(name: string, handler: StreamOpenHandler): void {
    this.handlers.set(name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  resolve(name: string): StreamOpenHandler | undefined {
    const exact = this.handlers.get(name);
    if (exact) return exact;
    const colon = name.indexOf(':');
    if (colon <= 0) return undefined;
    return this.handlers.get(name.slice(0, colon));
  }
}
