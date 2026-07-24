import { config } from "../package.json";
import hooks from "./hooks";
import type { mcpPrefsApi } from "./modules/mcp-server";
import type { McpRequestHandler } from "./modules/mcp-tools";
import { createZToolkit } from "./utils/ztoolkit";

/** The sandbox-global plugin object (`addon`): pure data plus the hook
 * table — behavior lives in the modules. A plain object, not a class; the
 * explicit interface carries the fields that are populated later. */
export interface Addon {
  data: {
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
  hooks: typeof hooks;
  // APIs (populated on startup; consumed by the prefs pane script)
  api: { mcp?: typeof mcpPrefsApi };
}

export function createAddon(): Addon {
  return {
    data: {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    },
    hooks,
    api: {},
  };
}
