import { config } from "../package.json";
import hooks from "./hooks";
import type { mcpPrefsApi } from "./modules/mcp-server";
import type { McpRequestHandler } from "./modules/mcp-tools";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: Localization;
    };
    /** SDK-bearing request handler, published by the lazily-loaded MCP
     * bundle (src/mcp-handler.ts) on first server start. */
    mcpHandler?: { handleRequest: McpRequestHandler };
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs (populated on startup; consumed by the prefs pane script)
  public api: { mcp?: ReturnType<typeof mcpPrefsApi> };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
