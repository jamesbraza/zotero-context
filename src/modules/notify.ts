import { logError } from "../utils/log";

/** Small toast in the corner; the plugin's only feedback surface. */
export function notify(text: string, success = true) {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 3000,
  })
    .createLine({ text, type: success ? "success" : "fail" })
    .show();
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
