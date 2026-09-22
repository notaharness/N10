import { useCallback, useEffect, useState } from 'react';
import type { LaunchStep } from '../../../host/contract.js';

/**
 * Tracks a remote launch's named steps (ux-machines.md §5): "Creating
 * worktree on workbox…" → "Starting claude…", not a spinner. Only a
 * remote launch ever has a step to show — `start()` mints a fresh
 * `launchId` for one attempt and the caller sends it on the request;
 * two concurrent launches, or a retry after a failure, each get their
 * own id, so `onLaunchStep` events never cross streams.
 *
 * A local launch never calls `start()` and this stays idle — callers
 * gate the whole progress display on the request's own `machine`
 * field, not on this hook's state, so a fast local launch never shows
 * a step display that would only slow it down by feel.
 */
export function useLaunchProgress() {
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [step, setStep] = useState<LaunchStep | null>(null);

  useEffect(() => {
    if (!launchId) return;
    return window.n10.onLaunchStep((event) => {
      if (event.launchId === launchId) setStep(event.step);
    });
  }, [launchId]);

  const start = useCallback((): string => {
    const id = crypto.randomUUID();
    setStep(null);
    setLaunchId(id);
    return id;
  }, []);

  const reset = useCallback(() => {
    setLaunchId(null);
    setStep(null);
  }, []);

  return { step, start, reset };
}
