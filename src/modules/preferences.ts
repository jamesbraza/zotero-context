import { getString } from "../utils/locale";
import { logError } from "../utils/log";

export function registerPrefsPane() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    scripts: [rootURI + "content/preferences.js"],
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  }).catch((e: unknown) => {
    logError("prefs pane", e);
  });
}
