import {
  BasicTool,
  ClipboardHelper,
  DialogHelper,
  KeyboardManager,
  makeHelperTool,
  ProgressWindowHelper,
  UITool,
  unregister,
} from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  const _ztoolkit = new ZoteroToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = __env__ === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = __env__ === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}

/**
 * On-demand toolkit: only the modules this plugin uses are bundled.
 *
 * Add modules here as needed, e.g. `Reader: ReaderTool`,
 * `Dialog: typeof DialogHelper`, `Patch: typeof PatchHelper`.
 */
class ZoteroToolkit extends BasicTool {
  UI: UITool;
  Keyboard: KeyboardManager;
  Clipboard: typeof ClipboardHelper;
  Dialog: typeof DialogHelper;
  ProgressWindow: typeof ProgressWindowHelper;

  constructor() {
    super();
    this.UI = new UITool(this);
    this.Keyboard = new KeyboardManager(this);
    this.Clipboard = makeHelperTool(ClipboardHelper, this);
    this.Dialog = makeHelperTool(DialogHelper, this);
    this.ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
  }

  /** Unregister everything created by the modules. */
  unregisterAll() {
    unregister(this);
  }
}
