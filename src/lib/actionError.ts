/**
 * What to do when calling a Server Action throws in the browser (as opposed
 * to the action running and returning its own error message).
 *
 * The usual cause is not the network: it is a page that was loaded before the
 * app was last rebuilt or restarted. Next.js gives every Server Action a new id
 * on each build, so an old page calls an id the server no longer has ("Failed
 * to find Server Action"). Reloading the page fixes it, so callers reload when
 * `stale` is true.
 */
export type ActionFailure = { message: string; stale: boolean };

const RELOADED_AT = 'logiclanes:stale-reload-at';
/** If a reload did not help within this time, do not reload again: say so instead. */
const RELOAD_COOLDOWN_MS = 20_000;

export function describeActionFailure(): ActionFailure {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { message: 'You are offline. Check your internet connection and try again.', stale: false };
  }
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) {
      // We reloaded moments ago and the call still fails: reloading again would just loop.
      return { message: 'The app is still restarting. Wait a few seconds and try again.', stale: false };
    }
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    // No storage (private mode): fall through and reload once.
  }
  return {
    message: 'This page was open while the app was updated, so it is out of date. Reloading it now.',
    stale: true,
  };
}
