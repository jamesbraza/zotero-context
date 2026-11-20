import { logError } from "../utils/log";

const CLOSE_MS = 3000;
/** Hard limit: hovering pauses Zotero's close timer, and under some window
 * systems (e.g. WSLg) the mouse-out that resumes it never arrives, which left
 * toasts up until clicked. */
const MAX_OPEN_MS = 8000;

/** Small toast in the corner; the plugin's only feedback surface. */
export function notify(text: string, success = true) {
  const toast = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: CLOSE_MS,
  })
    .createLine({ text, type: success ? "success" : "fail" })
    .show();
  Zotero.getMainWindow().setTimeout(() => {
    try {
      toast.win.close();
    } catch {
      // Already closed by its own timer or a click
    }
  }, MAX_OPEN_MS);
}

/**
 * Interaction-boundary error handler: run the action; on ANY throw or
 * rejection, toast the user and log the real error. Every user-triggered
 * async path (`void` call sites) goes through this so no failure is silent.
 */
export async function guard(
  context: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    notify(`${context} failed`, false);
    logError(context, e);
  }
}
