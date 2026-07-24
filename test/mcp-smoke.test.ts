import { assert } from "chai";
import { startHttpServer } from "../src/adapter/http-server";
import { handleRequest } from "../src/mcp-handler";
import {
  fieldText,
  itemForPaperId,
  paperInfoMap,
  trail,
} from "../src/modules/grab-session";
import type { McpDeps } from "../src/modules/mcp-tools";

declare const Components: any;

/**
 * MCP server smoke tests (same idiom as adapter-smoke, task 8.2): exercise
 * platform behavior we depend on but do not implement — httpd.js's
 * Host-identity validation (our DNS-rebinding defense; our own gate no
 * longer checks Host) and the UTF-8 converter-stream response path —
 * against a real listening socket, so Zotero-upgrade churn is caught in CI.
 *
 * The client is a raw XPCOM socket writer because fetch/XHR forbid forging
 * the Host header, which is the whole point of the first test.
 */

const PORT = 23987;
const TOKEN = "0123456789abcdef0123456789abcdef01234567";

function rawRequest(port: number, requestText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const Ci = Components.interfaces;
    const thread = Components.classes[
      "@mozilla.org/thread-manager;1"
    ].getService(Ci.nsIThreadManager).currentThread;
    const transport = Components.classes[
      "@mozilla.org/network/socket-transport-service;1"
    ]
      .getService(Ci.nsISocketTransportService)
      .createTransport([], "127.0.0.1", port, null, null);
    const output = transport.openOutputStream(
      Ci.nsITransport.OPEN_BLOCKING,
      0,
      0,
    );
    output.write(requestText, requestText.length);
    output.close();
    const input = transport
      .openInputStream(0, 0, 0)
      .QueryInterface(Ci.nsIAsyncInputStream);
    const scriptable = Components.classes[
      "@mozilla.org/scriptableinputstream;1"
    ].createInstance(Ci.nsIScriptableInputStream);
    scriptable.init(input);
    let data = "";
    const timeout = setTimeout(() => {
      try {
        input.close();
      } catch {
        // already closed
      }
      reject(new Error(`rawRequest timed out; got: ${data.slice(0, 200)}`));
    }, 10_000);
    const onReady = {
      onInputStreamReady: (stream: any) => {
        let available: number;
        try {
          available = stream.available();
        } catch {
          // EOF: server closed the connection — response complete
          clearTimeout(timeout);
          resolve(data);
          return;
        }
        if (available > 0) data += scriptable.read(available) as string;
        stream.asyncWait(onReady, 0, 0, thread);
      },
    };
    input.asyncWait(onReady, 0, 0, thread);
  });
}

/** The read loop yields a byte string; decode it as UTF-8 for assertions. */
function utf8Body(raw: string): string {
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0) & 0xff);
  return new TextDecoder().decode(bytes);
}

function post(host: string, body: string, token?: string): string {
  return (
    `POST /mcp HTTP/1.1\r\nHost: ${host}\r\n` +
    (token === undefined ? "" : `Authorization: Bearer ${token}\r\n`) +
    "Content-Type: application/json\r\n" +
    `Content-Length: ${new TextEncoder().encode(body).length}\r\n` +
    "Connection: close\r\n\r\n" +
    body
  );
}

const LIST_GRABS = JSON.stringify({
  jsonrpc: "2.0",
  method: "tools/call",
  params: { name: "list_grabs", arguments: {} },
  id: 1,
});

describe("mcp-smoke", function () {
  let close: (() => void) | undefined;

  before(function () {
    const deps: McpDeps = {
      trail,
      paperInfos: paperInfoMap(),
      itemForPaperId,
      fieldText,
    };
    close = startHttpServer(PORT, "/mcp", (req) =>
      handleRequest(deps, req, PORT, TOKEN),
    ).close;
  });

  after(function () {
    close?.();
    trail.clear();
  });

  it("rejects forged Host headers upstream of the gate (httpd identity)", async function () {
    this.timeout(15_000);
    const response = await rawRequest(
      PORT,
      post(`evil.example:${PORT}`, LIST_GRABS, TOKEN),
    );
    // httpd.js's ServerIdentity rejects unrecognized hosts with 400. If a
    // Zotero upgrade ever loses this behavior, re-add a Host check to
    // handleRequest (see design.md D7)
    assert.match(response, /^HTTP\/1\.1 400/);
  });

  it("enforces the bearer token on the real wire", async function () {
    this.timeout(15_000);
    const response = await rawRequest(
      PORT,
      post(`127.0.0.1:${PORT}`, LIST_GRABS),
    );
    assert.match(response, /^HTTP\/1\.1 401/);
  });

  it("serves an authorized tool call with UTF-8 intact", async function () {
    this.timeout(15_000);
    trail.clear();
    trail.append({
      ts: 1,
      kind: "text",
      text: "Grabbed from §4.3 — émigré",
      source: { paperId: "1/SMOKE", pageLabel: "7" },
    });
    const response = utf8Body(
      await rawRequest(PORT, post(`127.0.0.1:${PORT}`, LIST_GRABS, TOKEN)),
    );
    assert.match(response, /^HTTP\/1\.1 200/);
    // The converter-stream write path must not mangle non-ASCII
    assert.include(response, "§4.3");
    assert.include(response, "émigré");
  });

  it("pref enablement lazy-loads the handler bundle and serves requests", async function () {
    this.timeout(15_000);
    // Drive the RUNNING plugin (not the test bundle's imports): setting the
    // pref fires its observer, which must loadSubScript the handler bundle
    // and bind the socket — the end-to-end lazy path users take
    const runningAddon = (Zotero as any).ZoteroContext;
    const prefix = runningAddon.data.config.prefsPrefix as string;
    const LAZY_PORT = 23988;
    Zotero.Prefs.set(`${prefix}.mcpPort`, LAZY_PORT, true);
    Zotero.Prefs.set(`${prefix}.mcpToken`, TOKEN, true);
    try {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, true, true);
      // Pref observers may dispatch asynchronously — give the lazy load a
      // moment before treating the missing publish as a failure
      const deadline = Date.now() + 5_000;
      while (!runningAddon.data.mcpHandler && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(
        runningAddon.data.mcpHandler,
        "lazy bundle published its handler into the plugin sandbox",
      );
      const response = await rawRequest(
        LAZY_PORT,
        post(`127.0.0.1:${LAZY_PORT}`, LIST_GRABS, TOKEN),
      );
      assert.match(response, /^HTTP\/1\.1 200/);
    } finally {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, false, true);
      Zotero.Prefs.clear(`${prefix}.mcpPort`, true);
      Zotero.Prefs.clear(`${prefix}.mcpToken`, true);
    }
  });
});
