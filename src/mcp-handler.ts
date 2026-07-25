/**
 * Lazy MCP request-handling bundle (spec: mcp-delivery; design D7).
 *
 * Everything that pulls in the MCP SDK and zod lives behind this esbuild
 * entry — together they are the bulk of the plugin's script payload, so the
 * eager bundle must never import this module (or mcp-tools). The control
 * layer (modules/mcp-server.ts) loads the built bundle via loadSubScript on
 * first server start and consumes `addon.data.mcpHandler`.
 *
 * Stateless Streamable HTTP: each POST carries one JSON-RPC message and
 * receives one JSON response — no SSE, no session ids. A fresh SDK
 * `McpServer` is built per request and bridged through a single-exchange
 * Transport, so the SDK owns protocol correctness while the adapter owns
 * the socket. Deliberately lenient on MCP-Protocol-Version and Accept
 * headers: with no session or stream negotiation there is nothing for
 * them to select, and strictness would only break older clients.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  isJSONRPCRequest,
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { HttpRequest, HttpResponse } from "./adapter/http-server";
import { createMcpServer, type McpDeps } from "./modules/mcp-tools";
import { logError } from "./utils/log";
import { withTimeout } from "./utils/timeout";

/** A hung tool call must not hold the HTTP exchange open forever. */
const RESPONSE_TIMEOUT_MS = 30_000;

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

/** Constant-time equality for same-length strings: XOR-accumulates over
 * every position so match position never short-circuits. The up-front
 * length check is fine — token length is not secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Exported for tests; production traffic reaches it via the control
 * layer's lazy load, which also supplies `deps` from the main bundle's
 * grab-session state (see McpDeps). Routing and Host validation happen
 * upstream in httpd.js (foreign Hosts never reach this — smoke tests pin
 * that platform behavior); this gate owns Origin (httpd has no Origin
 * handling) and auth. */
export async function handleRequest(
  deps: McpDeps,
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
  // RFC 7235: the auth scheme is case-insensitive; the compare is
  // constant-time so match position never leaks through response timing
  const bearer = /^Bearer[ \t]+(.+)$/i.exec(
    req.headers.get("authorization") ?? "",
  );
  if (!bearer || !timingSafeEqual(bearer[1]!, auth)) {
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
  return dispatch(deps, message);
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

async function dispatch(
  deps: McpDeps,
  message: JSONRPCRequest,
): Promise<HttpResponse> {
  const server = createMcpServer(deps);
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

// Publish for the eager control layer: loadSubScript runs this bundle in
// the plugin sandbox, where `addon` exists. Under node unit tests the
// global is absent and this module is only imported for its exports.
if (typeof addon !== "undefined") {
  addon.data.mcpHandler = { handleRequest };
}
