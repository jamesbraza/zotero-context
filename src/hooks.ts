import { initLocale } from "./utils/locale";
import { registerBundleDelivery } from "./modules/bundle-delivery";
import { deactivateAllGrabModes, registerGrabMode } from "./modules/grab-mode";
import {
  mcpPrefsApi,
  registerMcpServer,
  unregisterMcpServer,
} from "./modules/mcp-server";
import { registerPaperIntro } from "./modules/paper-intro";
import { registerPrefsPane } from "./modules/preferences";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  // Plugin disabled/updated while parked on the awaits: registering now
  // would leak pref observers and the MCP socket with no unregister path
  if (!addon.data.alive) return;

  initLocale();
  registerPrefsPane();
  registerGrabMode();
  registerPaperIntro();
  registerBundleDelivery();
  registerMcpServer();
  addon.api.mcp = mcpPrefsApi();

  for (const win of Zotero.getMainWindows()) {
    onMainWindowLoad(win);
  }

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

function onMainWindowLoad(win: _ZoteroTypes.MainWindow): void {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // MozXULElement is typed `any` in zotero-types' MainWindow
  // (https://github.com/windingwind/zotero-types/issues/94)
  const mozXULElement = win.MozXULElement as {
    insertFTLIfNeeded: (path: string) => void;
  };
  mozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
}

function onMainWindowUnload(_win: Window): void {
  deactivateAllGrabModes();
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  // Grab mode attaches capture listeners directly to reader documents;
  // without this they would survive plugin disable and swallow every click
  deactivateAllGrabModes();
  // The MCP socket would likewise outlive a disabled plugin
  unregisterMcpServer();
  delete addon.api.mcp;
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
