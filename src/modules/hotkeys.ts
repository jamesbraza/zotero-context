/**
 * Leader-sequence hotkeys: Ctrl+' (Cmd+' on macOS) arms a 2s pending state and
 * the next bare letter fires its registered action (rationale: DESIGN.md).
 * Sequences deliberately work while a text field has focus — the prefix
 * types nothing and the action letter is swallowed — so there is no
 * editable-target suppression here.
 *
 * Modifiers are read off the raw event (the keyboard manager only populates
 * its KeyModifier options on keyup) and letters match by physical key code
 * (macOS Option/dead keys rewrite ev.key). The keyboard manager can deliver
 * one physical press from both the main window and the reader iframe, so the
 * pending state is module-shared and fires within 300ms are collapsed.
 */
import { advance, formatSequence, type LeaderState } from "../core/leader";

const handlers = new Map<string, (ev: KeyboardEvent) => void>();
const lastFire = new Map<string, number>();
let state: LeaderState = null;
let listening = false;

export function registerLeaderAction(
  letter: string,
  handler: (ev: KeyboardEvent) => void,
) {
  handlers.set(letter, handler);
  if (listening) return;
  listening = true;
  ztoolkit.Keyboard.register((ev) => {
    const now = Date.now();
    const step = advance(state, ev, now, [...handlers.keys()], Zotero.isMac);
    state = step.state;
    if (step.effect.kind === "pass") return;
    ev.preventDefault();
    if (step.effect.kind === "cancel") {
      // Keep a consumed Esc from also exiting grab mode / closing popups
      ev.stopPropagation();
      return;
    }
    if (step.effect.kind !== "fire") return;
    const fired = step.effect.letter;
    if (now - (lastFire.get(fired) ?? 0) < 300) return;
    lastFire.set(fired, now);
    handlers.get(fired)?.(ev);
  });
}

/** This platform's display form of a sequence, for tooltips and toasts. */
export function formatChord(letter: string): string {
  return formatSequence(letter, Zotero.isMac);
}
