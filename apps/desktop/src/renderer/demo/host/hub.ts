/**
 * The push half of the mock host: one listener set per channel, the
 * way the preload wires each `on…` subscription to an IPC channel.
 * Every subscribe returns its unsubscribe, as the contract requires.
 */
export class Channel<T> {
  private readonly listeners = new Set<(payload: T) => void>();

  subscribe = (cb: (payload: T) => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  emit(payload: T): void {
    for (const cb of this.listeners) cb(payload);
  }
}

/** Resolves after `ms`, so answers arrive the way IPC ones do. */
export function later<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
