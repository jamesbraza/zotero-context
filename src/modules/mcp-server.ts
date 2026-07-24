/**
 * MCP server lifecycle — the eager control layer (spec: mcp-delivery;
 * design D7). Off by default; enabled via prefs.
 *
 * This module must stay free of MCP SDK (and zod) imports: those live in
 * the lazily-loaded handler bundle (src/mcp-handler.ts), which is the bulk
 * of the plugin's script payload and is only parsed when the server first
 * starts. This layer owns the socket lifecycle, the bearer token (minted on
 * first enablement), and the prefs pane's copy-ready client setup
 * (`mcpPrefsApi`). Loopback bind and Host validation come from httpd.js —
 * smoke tests pin that platform behavior; Origin validation and auth live
 * in the handler bundle.
 */
import { startHttpServer, type HttpServerHandle } from "../adapter/http-server";
import { logError } from "../utils/log";
import { getPref, setPref } from "../utils/prefs";
import { copyText } from "./clipboard";
import { fieldText, itemForPaperId, paperInfoMap, trail } from "./grab-session";
import type { McpDeps, McpRequestHandler } from "./mcp-tools";
import { guard, notify } from "./notify";

/** Fallback when the mcpPort pref is out of range; the pref's default
 * (addon/prefs.js) is the same value. 23122 continues the Zotero block
 * (23119 connector, 23120 cookjohn/zotero-mcp) while skipping 23121,
 * already bound by zotero-filelink-bridge, zotero-notebooklm, and
 * aiops-lmstudio-zotero-plugin (and used as clautero's proxy sentinel). */
const DEFAULT_PORT = 23122;
const MCP_PATH = "/mcp";

function configuredPort(): number {
  const port = getPref("mcpPort");
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : DEFAULT_PORT;
}

/**
 * Bearer token, minted on first use and persisted in prefs. Prefs stay the
 * single source of truth: the running server reads this per request, so a
 * re-mint (e.g. after the pref was cleared) takes effect immediately.
 */
function token(): string {
  const existing = getPref("mcpToken");
  if (existing.length >= 32) return existing;
  // The shared global has WebCrypto in current Zotero; a main window is only
  // a fallback and may not exist (e.g. plugin enabled from Settings on macOS)
  const cryptoSource: Crypto | undefined =
    (globalThis as { crypto?: Crypto }).crypto ??
    (Zotero.getMainWindow() as Window | undefined)?.crypto;
  if (!cryptoSource) throw new Error("no WebCrypto source to mint token");
  const bytes = new Uint8Array(24);
  cryptoSource.getRandomValues(bytes);
  const minted = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  setPref("mcpToken", minted);
  return minted;
}

interface McpStatus {
  state: "off" | "running" | "error";
  port: number;
  message?: string;
}

let handle: HttpServerHandle | null = null;
let lastError: string | null = null;
let prefObserverIds: symbol[] = [];
const statusListeners = new Set<() => void>();

function getMcpStatus(): McpStatus {
  if (handle) return { state: "running", port: handle.port };
  if (getPref("mcpEnabled") && lastError !== null) {
    return { state: "error", port: configuredPort(), message: lastError };
  }
  return { state: "off", port: configuredPort() };
}

/** Web globals the MCP SDK expects that Zotero's plugin sandbox realm lacks
 * (verified empirically: `console` — Ajv reads it at construction — and
 * `AbortController`; the rest are the SDK's plausible dependencies, borrowed
 * defensively). All come from ONE realm (the main window) so the SDK's
 * cross-checks between them stay consistent. */
const BORROWED_GLOBALS = [
  "console",
  "AbortController",
  "AbortSignal",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "crypto",
] as const;

/**
 * The scope object the handler bundle is loaded with. It mirrors
 * bootstrap.js's ctx pattern: names on this object (plus the realm global)
 * are what the bundle can see — `addon` lets it publish its API, and the
 * borrowed web globals fill the sandbox's gaps. `console` gets an inert
 * fallback so a windowless startup cannot break the server.
 */
function handlerScope(): Record<string, unknown> {
  // Hidden window first: it lives for the whole app session, so the SDK's
  // captured references cannot become dead objects when the main window
  // closes (macOS keeps Zotero running windowless)
  let hidden: unknown;
  try {
    hidden = Services.appShell.hiddenDOMWindow;
  } catch (e) {
    logError("mcp handler scope (hidden window)", e);
  }
  const win = (hidden ?? Zotero.getMainWindow()) as unknown as
    Record<string, unknown> | undefined;
  const scope: Record<string, unknown> = { addon };
  for (const name of BORROWED_GLOBALS) {
    const value =
      (globalThis as unknown as Record<string, unknown>)[name] ?? win?.[name];
    if (value !== undefined) scope[name] = value;
  }
  scope.console ??= { log() {}, warn() {}, error() {} };
  return scope;
}

/**
 * Load the SDK-bearing handler bundle on demand — zod + MCP SDK are the
 * bulk of the plugin's script payload, and MCP-off users (the default)
 * never parse them. loadSubScript runs the bundle in this same plugin
 * sandbox, where it publishes `addon.data.mcpHandler`; loading is
 * effectively once (the publish is idempotent and checked first).
 */
function ensureHandler(): McpRequestHandler | null {
  if (!addon.data.mcpHandler) {
    try {
      Services.scriptloader.loadSubScript(
        `${rootURI}content/scripts/${addon.data.config.addonRef}-mcp.js`,
        handlerScope(),
      );
    } catch (e) {
      logError("mcp handler load", e);
      return null;
    }
  }
  return addon.data.mcpHandler?.handleRequest ?? null;
}

function start(): void {
  if (handle) return;
  const port = configuredPort();
  try {
    // Pre-mint so the prefs pane's copy buttons work before the first
    // request; a mint failure takes the graceful-disable path below
    token();
    const handleRequest = ensureHandler();
    if (!handleRequest) {
      // Graceful disable, same contract as a failed bind
      lastError = "Could not load the MCP request handler — see debug log";
      notify("MCP server disabled: handler failed to load", false);
      return;
    }
    // Session state crosses the bundle boundary here, as values: the lazy
    // bundle carries its own (empty) copies of grab-session's singletons,
    // so the handler must be fed THIS bundle's instances (see McpDeps)
    const deps: McpDeps = {
      trail,
      paperInfos: paperInfoMap(),
      itemForPaperId,
      fieldText,
    };
    handle = startHttpServer(port, MCP_PATH, (req) =>
      handleRequest(deps, req, port, token()),
    );
    lastError = null;
  } catch (e) {
    // Graceful disable: the clipboard path never depends on the server
    lastError = `Could not start on 127.0.0.1:${port} — is the port in use?`;
    logError("mcp server start", e);
    notify(`MCP server disabled: port ${port} is unavailable`, false);
  }
}

function stop(): void {
  handle?.close();
  handle = null;
}

function applyPrefs(): void {
  stop();
  if (getPref("mcpEnabled")) start();
  else lastError = null;
  for (const listener of statusListeners) {
    try {
      listener();
    } catch (e) {
      logError("mcp status listener", e);
    }
  }
}

/** Startup hook: honors the enabled pref and follows later pref changes. */
export function registerMcpServer(): void {
  applyPrefs();
  const prefix = addon.data.config.prefsPrefix;
  for (const key of ["mcpEnabled", "mcpPort"]) {
    prefObserverIds.push(
      Zotero.Prefs.registerObserver(`${prefix}.${key}`, applyPrefs, true),
    );
  }
}

/** Shutdown hook: close the socket and stop watching prefs. */
export function unregisterMcpServer(): void {
  for (const id of prefObserverIds) Zotero.Prefs.unregisterObserver(id);
  prefObserverIds = [];
  statusListeners.clear();
  stop();
}

/** Copy-ready setup surface for the prefs pane (spec: mcp-delivery). */
export function mcpPrefsApi() {
  const endpoint = () => `http://127.0.0.1:${configuredPort()}${MCP_PATH}`;
  const claudeCodeCommand = () =>
    `claude mcp add --transport http zotero-context ${endpoint()} ` +
    `--header "Authorization: Bearer ${token()}"`;
  // The `mcpServers` JSON schema is the de facto cross-client config format
  // (Claude desktop, Cursor, Windsurf, ...)
  const mcpConfigJson = () =>
    JSON.stringify(
      {
        mcpServers: {
          "zotero-context": {
            type: "http",
            url: endpoint(),
            headers: { Authorization: `Bearer ${token()}` },
          },
        },
      },
      null,
      2,
    );
  // guard(): a failed copy (clipboard, token mint) toasts + logs, never
  // vanishes into the prefs pane's event handler
  const copied = (what: string, text: () => string) =>
    guard(`Copy ${what}`, () => {
      copyText(text());
      notify(`${what} copied`);
    });
  return {
    status: getMcpStatus,
    /** Subscribe to status changes; returns unsubscribe. */
    onStatusChange: (listener: () => void): (() => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    copyClaudeCodeCommand: () => {
      void copied("Claude Code setup command", claudeCodeCommand);
    },
    copyMcpConfig: () => {
      void copied("MCP config", mcpConfigJson);
    },
    copyToken: () => {
      void copied("Token", token);
    },
  };
}
