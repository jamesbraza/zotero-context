/**
 * Thin wrapper over Mozilla's httpd.js (`HttpServer`), which ships inside
 * Zotero's Firefox platform (chrome://remote/content/server/httpd.sys.mjs).
 * It owns sockets, HTTP parsing, routing (unregistered paths get its 404),
 * Host-identity validation (foreign Host headers are rejected before
 * reaching handlers — the DNS-rebinding defense; smoke tests pin this
 * platform behavior), and response framing; this wrapper only adapts its
 * request/response objects to a typed handler interface.
 *
 * Loopback-only by construction: `start(port)` binds the "localhost"
 * identity, which httpd.js maps to a loopback-only server socket.
 */
import { logError } from "../utils/log";

declare const ChromeUtils: any;
declare const Components: any;

export interface HttpRequest {
  method: string;
  /** Header names lowercased. */
  headers: ReadonlyMap<string, string>;
  body: string;
}

export interface HttpResponse {
  status: number;
  body?: string;
  contentType?: string;
  extraHeaders?: Record<string, string>;
}

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>;

export interface HttpServerHandle {
  port: number;
  /** Resolves once pending requests drain and the socket is released. */
  close: () => Promise<void>;
}

/** 1 MiB (2^20). Inbound JSON-RPC bodies here are tiny (tool calls with a
 * grab id or watermark), so any conventional JSON-body cap has huge margin;
 * this matches nginx's default client_max_body_size rather than any MCP
 * spec value. Oversized bodies are refused before the gate and JSON.parse
 * see them (httpd.js has already buffered the bytes by then). */
const MAX_BODY_BYTES = 1_048_576;

/**
 * Serve `handler` at `path` on 127.0.0.1:<port>. Throws on bind failure
 * (port in use) — callers implement the graceful-disable contract.
 */
export function startHttpServer(
  port: number,
  path: string,
  handler: HttpHandler,
): HttpServerHandle {
  const { HttpServer } = ChromeUtils.importESModule(
    "chrome://remote/content/server/httpd.sys.mjs",
  );
  const server = new HttpServer();
  server.registerPathHandler(path, {
    handle: (request: any, response: any) => {
      response.processAsync();
      let req: HttpRequest;
      try {
        if (request.bodyInputStream.available() > MAX_BODY_BYTES) {
          writeResponse(response, { status: 413, body: "" });
          return;
        }
        req = toRequest(request);
      } catch (e) {
        logError("mcp http request", e);
        writeResponse(response, { status: 500, body: "" });
        return;
      }
      handler(req).then(
        (res) => {
          writeResponse(response, res);
        },
        (e: unknown) => {
          logError("mcp http handler", e);
          writeResponse(response, { status: 500, body: "" });
        },
      );
    },
  });
  server.start(port);
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        try {
          server.stop(() => {
            resolve();
          });
        } catch (e) {
          logError("mcp http close", e);
          resolve();
        }
      }),
  };
}

/** The only headers the MCP gate reads; skip enumerating the rest. */
const RELEVANT_HEADERS = ["origin", "authorization"];

/** NetUtil, resolved once on first body read instead of per request. */
let netUtil: any;

function toRequest(request: any): HttpRequest {
  const headers = new Map<string, string>();
  for (const name of RELEVANT_HEADERS) {
    if (request.hasHeader(name)) headers.set(name, request.getHeader(name));
  }
  const available: number = request.bodyInputStream.available();
  let body = "";
  if (available > 0) {
    netUtil ??= ChromeUtils.importESModule(
      "resource://gre/modules/NetUtil.sys.mjs",
    ).NetUtil;
    body = netUtil.readInputStreamToString(request.bodyInputStream, available, {
      charset: "UTF-8",
    });
  }
  return { method: request.method, headers, body };
}

function writeResponse(response: any, res: HttpResponse): void {
  try {
    // Empty reason phrase is valid HTTP; httpd.js accepts a falsy description
    response.setStatusLine("1.1", res.status, "");
    response.setHeader(
      "Content-Type",
      res.contentType ?? "application/json",
      false,
    );
    for (const [key, value] of Object.entries(res.extraHeaders ?? {})) {
      response.setHeader(key, value, false);
    }
    if (res.body) {
      // Platform UTF-8 encoder writing straight to the body stream. Never
      // call the converter's close() — it would close the underlying stream,
      // whose lifecycle belongs to response.finish()
      const converter = Components.classes[
        "@mozilla.org/intl/converter-output-stream;1"
      ].createInstance(Components.interfaces.nsIConverterOutputStream);
      converter.init(response.bodyOutputStream, "UTF-8");
      converter.writeString(res.body);
    }
  } catch (e) {
    logError("mcp http respond", e);
  } finally {
    try {
      response.finish();
    } catch {
      // already finished
    }
  }
}
