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
    // Non-blocking chunked write: a blocking write of a large body (the 413
    // test sends >1 MiB) deadlocks the process — the kernel socket buffer
    // fills, the blocking write pins the main thread, and httpd.js reads on
    // that same thread, so neither side can progress
    const output = transport
      .openOutputStream(0, 0, 0)
      .QueryInterface(Ci.nsIAsyncOutputStream);
    let written = 0;
    const writeMore = () => {
      try {
        while (written < requestText.length) {
          written += output.write(
            requestText.slice(written),
            requestText.length - written,
          ) as number;
        }
        output.close();
      } catch (e) {
        if (
          (e as { result?: number }).result ===
          (Components.results.NS_BASE_STREAM_WOULD_BLOCK as number)
        ) {
          output.asyncWait({ onOutputStreamReady: writeMore }, 0, 0, thread);
          return;
        }
        // A later timeout/EOF rejection is a no-op after this one
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    writeMore();
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

/** The running plugin instance (not this test bundle's module graph). */
function runningAddon() {
  return (Zotero as any).ZoteroContext;
}

/** Poll `cond` every 100 ms until true or `ms` elapses. */
async function pollUntil(cond: () => boolean, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return cond();
}

describe("mcp-smoke", function () {
  let close: (() => Promise<void>) | undefined;

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

  after(async function () {
    await close?.();
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

  it("413s oversized bodies before they reach the gate", async function () {
    this.timeout(15_000);
    // One byte over the adapter's MAX_BODY_BYTES cap
    const oversized = "x".repeat(1_048_577);
    const response = await rawRequest(
      PORT,
      post(`127.0.0.1:${PORT}`, oversized, TOKEN),
    );
    assert.match(response, /^HTTP\/1\.1 413/);
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
    this.timeout(20_000);
    // Drive the RUNNING plugin (not the test bundle's imports): setting the
    // pref fires its observer, which must loadSubScript the handler bundle
    // and bind the socket — the end-to-end lazy path users take
    const running = runningAddon();
    const prefix = running.data.config.prefsPrefix as string;
    const LAZY_PORT = 23988;
    const MOVED_PORT = 23989;
    Zotero.Prefs.set(`${prefix}.mcpPort`, LAZY_PORT, true);
    Zotero.Prefs.set(`${prefix}.mcpToken`, TOKEN, true);
    try {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, true, true);
      // Pref observers may dispatch asynchronously — give the lazy load a
      // moment before treating the missing publish as a failure
      assert.ok(
        await pollUntil(() => Boolean(running.data.mcpHandler)),
        "lazy bundle published its handler into the plugin sandbox",
      );
      const response = await rawRequest(
        LAZY_PORT,
        post(`127.0.0.1:${LAZY_PORT}`, LIST_GRABS, TOKEN),
      );
      assert.match(response, /^HTTP\/1\.1 200/);

      // Port change restarts onto the new port: the observer drains the
      // old socket, then re-binds
      Zotero.Prefs.set(`${prefix}.mcpPort`, MOVED_PORT, true);
      assert.ok(
        await pollUntil(() => {
          const status = running.api.mcp.status();
          return status.state === "running" && status.port === MOVED_PORT;
        }),
        "server restarted on the new port",
      );
      const moved = await rawRequest(
        MOVED_PORT,
        post(`127.0.0.1:${MOVED_PORT}`, LIST_GRABS, TOKEN),
      );
      assert.match(moved, /^HTTP\/1\.1 200/);
      // The old port no longer answers MCP: refused outright or a non-200
      let oldPortServes = false;
      try {
        const old = await rawRequest(
          LAZY_PORT,
          post(`127.0.0.1:${LAZY_PORT}`, LIST_GRABS, TOKEN),
        );
        oldPortServes = /^HTTP\/1\.1 200/.test(old);
      } catch {
        // Connection refused: exactly what a drained socket should do
      }
      assert.isFalse(oldPortServes, "old port stopped serving");
    } finally {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, false, true);
      Zotero.Prefs.clear(`${prefix}.mcpPort`, true);
      Zotero.Prefs.clear(`${prefix}.mcpToken`, true);
    }
  });

  it("gracefully disables on bind failure and recovers on a free port", async function () {
    this.timeout(20_000);
    const running = runningAddon();
    const prefix = running.data.config.prefsPrefix as string;
    const BUSY_PORT = 23990;
    const FREE_PORT = 23991;
    // Occupy the port so the plugin's bind must fail
    const blocker = startHttpServer(BUSY_PORT, "/blocker", () =>
      Promise.resolve({ status: 200, body: "" }),
    );
    Zotero.Prefs.set(`${prefix}.mcpToken`, TOKEN, true);
    Zotero.Prefs.set(`${prefix}.mcpPort`, BUSY_PORT, true);
    try {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, true, true);
      assert.ok(
        await pollUntil(() => running.api.mcp.status().state === "error"),
        "bind failure surfaced as an error status",
      );
      assert.include(
        running.api.mcp.status().message as string,
        String(BUSY_PORT),
        "error message names the contested port",
      );
      // Recovery: moving to a free port restarts cleanly
      Zotero.Prefs.set(`${prefix}.mcpPort`, FREE_PORT, true);
      assert.ok(
        await pollUntil(() => running.api.mcp.status().state === "running"),
        "server recovered on the free port",
      );
      const response = await rawRequest(
        FREE_PORT,
        post(`127.0.0.1:${FREE_PORT}`, LIST_GRABS, TOKEN),
      );
      assert.match(response, /^HTTP\/1\.1 200/);
    } finally {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, false, true);
      Zotero.Prefs.clear(`${prefix}.mcpPort`, true);
      Zotero.Prefs.clear(`${prefix}.mcpToken`, true);
      await blocker.close();
    }
  });

  it("re-mints a malformed token pref instead of trusting it", async function () {
    this.timeout(20_000);
    const running = runningAddon();
    const prefix = running.data.config.prefsPrefix as string;
    const REMINT_PORT = 23992;
    // Long enough to pass a naive length check, but not hex: must be
    // replaced, never served as a credential
    Zotero.Prefs.set(`${prefix}.mcpToken`, "x".repeat(40), true);
    Zotero.Prefs.set(`${prefix}.mcpPort`, REMINT_PORT, true);
    try {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, true, true);
      assert.ok(
        await pollUntil(() => running.api.mcp.status().state === "running"),
        "server started",
      );
      const minted = Zotero.Prefs.get(`${prefix}.mcpToken`, true) as string;
      assert.match(minted, /^[0-9a-f]{48}$/, "token was re-minted");
      const response = await rawRequest(
        REMINT_PORT,
        post(`127.0.0.1:${REMINT_PORT}`, LIST_GRABS, minted),
      );
      assert.match(response, /^HTTP\/1\.1 200/);
    } finally {
      Zotero.Prefs.set(`${prefix}.mcpEnabled`, false, true);
      Zotero.Prefs.clear(`${prefix}.mcpPort`, true);
      Zotero.Prefs.clear(`${prefix}.mcpToken`, true);
    }
  });
});
