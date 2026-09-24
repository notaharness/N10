/** Resolves once `check` holds, polling; rejects after `ms`, so a
 *  regression fails its test rather than hanging it. */
export function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) resolve();
      else if (Date.now() > deadline) reject(new Error('timed out'));
      else setTimeout(tick, 2);
    };
    tick();
  });
}
