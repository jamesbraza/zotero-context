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
  close: () => void;
}

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
    close: () => {
      try {
        server.stop(() => {
          // Nothing to clean up once pending requests drain
        });
      } catch (e) {
        logError("mcp http close", e);
      }
    },
  };
}

/** The only headers the MCP gate reads; skip enumerating the rest. */
const RELEVANT_HEADERS = ["origin", "authorization"];

function toRequest(request: any): HttpRequest {
  const headers = new Map<string, string>();
  for (const name of RELEVANT_HEADERS) {
    if (request.hasHeader(name)) headers.set(name, request.getHeader(name));
  }
  const available: number = request.bodyInputStream.available();
  let body = "";
  if (available > 0) {
    const { NetUtil } = ChromeUtils.importESModule(
      "resource://gre/modules/NetUtil.sys.mjs",
    );
    body = NetUtil.readInputStreamToString(request.bodyInputStream, available, {
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
