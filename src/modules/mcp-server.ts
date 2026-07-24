/**
 * MCP server lifecycle (spec: mcp-delivery; design D7).
 *
 * Off by default; enabled via prefs. Stateless Streamable HTTP: each POST
 * carries one JSON-RPC message and receives one JSON response — no SSE, no
 * session ids. A fresh SDK `McpServer` is built per request and bridged to
 * the HTTP layer through a single-exchange Transport, so the SDK owns
 * protocol correctness while the adapter owns the socket.
 *
 * Security posture (D7): loopback bind and Host validation come from
 * httpd.js — smoke tests pin that platform behavior; this module adds
 * Origin validation and a bearer token minted on first enablement. The
 * prefs pane renders copy-ready client setup from `mcpPrefsApi`.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  isJSONRPCRequest,
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  startHttpServer,
  type HttpRequest,
  type HttpResponse,
  type HttpServerHandle,
} from "../adapter/http-server";
import { logError } from "../utils/log";
import { getPref, setPref } from "../utils/prefs";
import { withTimeout } from "../utils/timeout";
import { copyText } from "./clipboard";
import { createMcpServer } from "./mcp-tools";
import { guard, notify } from "./notify";

/** Fallback when the mcpPort pref is out of range; the pref's default
 * (addon/prefs.js) is the same value. 23122 continues the Zotero block
 * (23119 connector, 23120 cookjohn/zotero-mcp) while skipping 23121,
 * already bound by zotero-filelink-bridge, zotero-notebooklm, and
 * aiops-lmstudio-zotero-plugin (and used as clautero's proxy sentinel). */
const DEFAULT_PORT = 23122;
const MCP_PATH = "/mcp";
/** A hung tool call must not hold the HTTP exchange open forever. */
const RESPONSE_TIMEOUT_MS = 30_000;

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

function start(): void {
  if (handle) return;
  const port = configuredPort();
  try {
    // Pre-mint so the prefs pane's copy buttons work before the first
    // request; a mint failure takes the graceful-disable path below
    token();
    handle = startHttpServer(port, MCP_PATH, (req) =>
      handleRequest(req, port, token()),
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

// --- HTTP request handling ------------------------------------------------

const emptyJson = (status: number): HttpResponse => ({ status, body: "" });

function rpcError(
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
): HttpResponse {
  return {
    status,
    body: JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
  };
}

/** Best-effort request id from an unvalidated JSON-RPC body. */
function rawId(raw: unknown): string | number | null {
  if (typeof raw === "object" && raw !== null && "id" in raw) {
    const id = raw.id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}

/** Exported for tests; production traffic reaches it only via `start`.
 * Routing and Host validation happen upstream in httpd.js (foreign Hosts
 * never reach this — smoke tests pin that platform behavior); this gate
 * owns Origin (httpd has no Origin handling) and auth. */
export async function handleRequest(
  req: HttpRequest,
  port: number,
  auth: string,
): Promise<HttpResponse> {
  // Origin validation first: defeats browser-based requests regardless of
  // auth (origin-less native clients pass)
  const origin = req.headers.get("origin");
  if (
    origin !== undefined &&
    origin !== `http://127.0.0.1:${port}` &&
    origin !== `http://localhost:${port}`
  ) {
    return emptyJson(403);
  }
  if (req.method !== "POST") {
    // Stateless: no SSE stream to GET, no session to DELETE
    return { status: 405, body: "", extraHeaders: { Allow: "POST" } };
  }
  if (req.headers.get("authorization") !== `Bearer ${auth}`) {
    return {
      status: 401,
      body: "",
      extraHeaders: { "WWW-Authenticate": "Bearer" },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(req.body);
  } catch {
    return rpcError(400, ErrorCode.ParseError, "Parse error");
  }
  if (Array.isArray(raw)) {
    return rpcError(
      400,
      ErrorCode.InvalidRequest,
      "JSON-RPC batching is not supported",
    );
  }
  let message: JSONRPCMessage;
  try {
    message = JSONRPCMessageSchema.parse(raw);
  } catch {
    return rpcError(
      400,
      ErrorCode.InvalidRequest,
      "Invalid JSON-RPC message",
      rawId(raw),
    );
  }
  if (!isJSONRPCRequest(message)) {
    // Notifications and client responses need no reply in stateless mode
    return emptyJson(202);
  }
  return dispatch(message);
}

/** Bridges exactly one JSON-RPC exchange between HTTP and the SDK server. */
class SingleRequestTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private resolveResponse: ((message: JSONRPCMessage) => void) | undefined;
  readonly response = new Promise<JSONRPCMessage>((resolve) => {
    this.resolveResponse = resolve;
  });

  start(): Promise<void> {
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    // The first server->client message is the response to our one request;
    // a stateless server sends nothing else worth forwarding
    this.resolveResponse?.(message);
    this.resolveResponse = undefined;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.onclose?.();
    return Promise.resolve();
  }

  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

async function dispatch(message: JSONRPCRequest): Promise<HttpResponse> {
  const server = createMcpServer();
  const transport = new SingleRequestTransport();
  try {
    await server.connect(transport);
    transport.deliver(message);
    const response = await withTimeout(transport.response, RESPONSE_TIMEOUT_MS);
    if (!response) {
      return rpcError(
        500,
        ErrorCode.InternalError,
        "Request timed out",
        message.id,
      );
    }
    return { status: 200, body: JSON.stringify(response) };
  } catch (e) {
    logError("mcp dispatch", e);
    return rpcError(500, ErrorCode.InternalError, "Internal error", message.id);
  } finally {
    server.close().catch((e: unknown) => {
      logError("mcp server close", e);
    });
  }
}
