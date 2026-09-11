/**
 * Leader-key sequences (rationale: DESIGN.md): the accel+quote prefix
 * (Ctrl+' on Windows/Linux, Cmd+' on macOS) arms a short-lived pending state,
 * and the next letter keypress — bare, or with the accel still held from the
 * prefix — selects an action. Pure logic with injected timestamps; the
 * hotkeys module adapts real KeyboardEvents.
 *
 * Matching uses physical key codes (ev.code): on macOS, Option and dead
 * keys rewrite ev.key (Option+G yields "©"), and key positions — not the
 * characters they type — are what stays put across platforms.
 */

/** The KeyboardEvent fields leader matching reads (structurally satisfied). */
export interface LeaderKeyEvent {
  type: string;
  repeat: boolean;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** How long an armed prefix waits for its action letter. */
export const LEADER_TIMEOUT_MS = 2000;

/** Armed and waiting for an action letter; null when idle. */
export type LeaderState = { pendingUntil: number } | null;

export type LeaderEffect =
  /** Prefix pressed: consume the event and arm. */
  | { kind: "arm" }
  /** Action letter pressed while armed: consume the event, run its action. */
  | { kind: "fire"; letter: string }
  /** Escape while armed: consume the event (leave grab mode etc. alone). */
  | { kind: "cancel" }
  /** Not ours: let the event through untouched. */
  | { kind: "pass" };

/** The accel+quote chord: Cmd+' on macOS, Ctrl+' elsewhere — nothing more. */
export function isPrefix(ev: LeaderKeyEvent, isMac: boolean): boolean {
  if (ev.type !== "keydown" || ev.repeat || ev.code !== "Quote") return false;
  if (ev.altKey || ev.shiftKey) return false;
  return isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
}

/** The registered letter a keydown selects, if any: bare, or with only the
 * platform accel (still held over from the prefix) and/or Shift. */
export function matchAction(
  ev: LeaderKeyEvent,
  letters: readonly string[],
  isMac: boolean,
): string | null {
  if (ev.type !== "keydown" || ev.repeat || ev.altKey) return null;
  const wrongAccel = isMac ? ev.ctrlKey : ev.metaKey;
  if (wrongAccel) return null;
  const letter = letters.find((l) => ev.code === `Key${l.toUpperCase()}`);
  return letter ?? null;
}

/** Modifier keydowns must not cancel an armed prefix (accel is still held
 * when its keyup order interleaves, and Shift may precede a letter). */
export function isModifierOnly(ev: LeaderKeyEvent): boolean {
  return /^(?:Shift|Control|Alt|Meta|OS)(?:Left|Right)$/.test(ev.code);
}

/** One step of the leader state machine. */
export function advance(
  state: LeaderState,
  ev: LeaderKeyEvent,
  now: number,
  letters: readonly string[],
  isMac: boolean,
): { state: LeaderState; effect: LeaderEffect } {
  if (isPrefix(ev, isMac)) {
    return {
      state: { pendingUntil: now + LEADER_TIMEOUT_MS },
      effect: { kind: "arm" },
    };
  }
  const pending = state !== null && now <= state.pendingUntil ? state : null;
  if (!pending) return { state: null, effect: { kind: "pass" } };
  // Armed: only fresh keydowns advance the sequence
  if (ev.type !== "keydown" || ev.repeat || isModifierOnly(ev)) {
    return { state: pending, effect: { kind: "pass" } };
  }
  if (ev.code === "Escape") return { state: null, effect: { kind: "cancel" } };
  const letter = matchAction(ev, letters, isMac);
  if (letter !== null) return { state: null, effect: { kind: "fire", letter } };
  // An abandoned prefix must not eat typed text
  return { state: null, effect: { kind: "pass" } };
}

/** Display form of a sequence: "Cmd+' G" on macOS, "Ctrl+' G" elsewhere. */
export function formatSequence(letter: string, isMac: boolean): string {
  const prefix = isMac ? "Cmd+'" : "Ctrl+'";
  return `${prefix} ${letter.toUpperCase()}`;
}
