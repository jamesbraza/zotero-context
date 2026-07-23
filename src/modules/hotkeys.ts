/**
 * Ctrl+Alt+<key> chord registration with debouncing: the keyboard manager
 * can deliver one physical press from both the main window and the reader
 * iframe, so fires within 300ms are collapsed.
 */
const lastFire = new Map<string, number>();

export function registerChord(
  key: string,
  handler: (ev: KeyboardEvent) => void,
) {
  ztoolkit.Keyboard.register((ev) => {
    if (ev.type !== "keydown" || ev.repeat || !ev.ctrlKey || !ev.altKey) {
      return;
    }
    if (ev.key.toLowerCase() !== key) return;
    const now = Date.now();
    if (now - (lastFire.get(key) ?? 0) < 300) return;
    lastFire.set(key, now);
    handler(ev);
  });
}
