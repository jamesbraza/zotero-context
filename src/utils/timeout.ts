/**
 * Resolve with the promise's value, or null once `ms` elapse — whichever
 * comes first. The timer is cleared on settle either way, so no stray
 * main-thread timers outlive their work.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // If the timeout won, a later rejection of the losing promise must not
    // surface as an unhandled rejection
    promise.catch(() => undefined);
  }
}
