/**
 * Error logging for unexpected failures. Expected environmental absences
 * (missing private APIs, unrendered pages) return null via explicit presence
 * checks and are NOT logged; anything that *throws* goes through here so it
 * is never silently swallowed (see design.md error-handling notes).
 */
export function logError(context: string, err: unknown) {
  try {
    ztoolkit.log(`[error] ${context}:`, err);
  } catch {
    // ztoolkit is a plugin-sandbox global; outside it (test runner window)
    // fall back — the error path itself must never throw
    try {
      Zotero.debug(`[error] ${context}: ${String(err)}`);
    } catch {
      // no logging surface at all — give up quietly
    }
  }
}
