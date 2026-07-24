import { assert } from "chai";
import type { HttpRequest } from "../src/adapter/http-server";
import {
  fieldText,
  itemForPaperId,
  paperInfoMap,
  trail,
} from "../src/modules/grab-session";
import { handleRequest as handleMcpRequest } from "../src/mcp-handler";
import { pngDimensions, type McpDeps } from "../src/modules/mcp-tools";

const PORT = 23122;
const TOKEN = "0123456789abcdef0123456789abcdef01234567";

/** Deps from this test bundle's own module graph — the same `trail` the
 * tests seed below, mirroring how the eager control layer feeds the lazy
 * handler its main-bundle instances. */
const DEPS: McpDeps = {
  trail,
  paperInfos: paperInfoMap(),
  itemForPaperId,
  fieldText,
};
const handleRequest = (req: HttpRequest, port: number, auth: string) =>
  handleMcpRequest(DEPS, req, port, auth);

// 1x1 transparent PNG
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

interface RequestOverrides {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}

function request(overrides: RequestOverrides = {}): HttpRequest {
  const merged: Record<string, string | undefined> = {
    authorization: `Bearer ${TOKEN}`,
    ...overrides.headers,
  };
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) headers.set(k, v);
  }
  return {
    method: overrides.method ?? "POST",
    headers,
    body: overrides.body ?? "",
  };
}

function rpcBody(method: string, params?: unknown, id?: number): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method,
    ...(params === undefined ? {} : { params }),
    ...(id === undefined ? {} : { id }),
  });
}

const INITIALIZE_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0.0.0" },
};

interface RpcResponse {
  result?: {
    content?: { type: string; text?: string; data?: string }[];
    isError?: boolean;
    tools?: { name: string }[];
    serverInfo?: { name: string };
  };
  error?: { code: number };
  id?: string | number | null;
}

function parseResponse(body: string | undefined): RpcResponse {
  return JSON.parse(body ?? "") as RpcResponse;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResponse> {
  const res = await handleRequest(
    request({ body: rpcBody("tools/call", { name, arguments: args }, 1) }),
    PORT,
    TOKEN,
  );
  assert.equal(res.status, 200);
  return parseResponse(res.body);
}

interface ListGrabsPayload {
  watermark: number;
  grabs: Record<string, unknown>[];
}

/** First text content of a list_grabs result, parsed as JSON. */
function toolJson(response: RpcResponse): ListGrabsPayload {
  const text = response.result?.content?.[0]?.text;
  assert.isString(text);
  return JSON.parse(text!) as ListGrabsPayload;
}

describe("mcp", function () {
  describe("modules/mcp-server request gate", function () {
    // Host validation is httpd.js's job — smoke tests pin that platform
    // behavior end-to-end; this gate owns Origin and auth

    it("rejects browser Origins, allows loopback Origins", async function () {
      const rejected = await handleRequest(
        request({ headers: { origin: "https://evil.example" } }),
        PORT,
        TOKEN,
      );
      assert.equal(rejected.status, 403);
      // A loopback Origin passes the gate and reaches the method check
      const allowed = await handleRequest(
        request({
          method: "GET",
          headers: { origin: `http://127.0.0.1:${PORT}` },
        }),
        PORT,
        TOKEN,
      );
      assert.equal(allowed.status, 405);
    });

    it("405s non-POST methods", async function () {
      assert.equal(
        (await handleRequest(request({ method: "DELETE" }), PORT, TOKEN))
          .status,
        405,
      );
    });

    it("401s missing and wrong bearer tokens", async function () {
      assert.equal(
        (
          await handleRequest(
            request({ headers: { authorization: undefined } }),
            PORT,
            TOKEN,
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await handleRequest(
            request({ headers: { authorization: "Bearer wrong" } }),
            PORT,
            TOKEN,
          )
        ).status,
        401,
      );
    });

    it("400s unparsable and batched bodies", async function () {
      assert.equal(
        (await handleRequest(request({ body: "{oops" }), PORT, TOKEN)).status,
        400,
      );
      assert.equal(
        (await handleRequest(request({ body: "[]" }), PORT, TOKEN)).status,
        400,
      );
    });

    it("echoes the request id on invalid-message errors", async function () {
      const res = await handleRequest(
        request({ body: '{"jsonrpc":"2.0","method":123,"id":7}' }),
        PORT,
        TOKEN,
      );
      assert.equal(res.status, 400);
      assert.equal(parseResponse(res.body).id, 7);
    });

    it("202s notifications without dispatching", async function () {
      const res = await handleRequest(
        request({ body: rpcBody("notifications/initialized") }),
        PORT,
        TOKEN,
      );
      assert.equal(res.status, 202);
    });

    it("answers initialize with the server identity", async function () {
      const res = await handleRequest(
        request({ body: rpcBody("initialize", INITIALIZE_PARAMS, 1) }),
        PORT,
        TOKEN,
      );
      assert.equal(res.status, 200);
      assert.equal(
        parseResponse(res.body).result?.serverInfo?.name,
        "zotero-context",
      );
    });

    it("serves tools/list statelessly (no prior initialize)", async function () {
      const res = await handleRequest(
        request({ body: rpcBody("tools/list", undefined, 2) }),
        PORT,
        TOKEN,
      );
      assert.equal(res.status, 200);
      const names = parseResponse(res.body).result?.tools?.map((t) => t.name);
      assert.sameMembers(names ?? [], [
        "list_grabs",
        "get_grab",
        "get_paper",
        "fetch_pdf",
      ]);
    });
  });

  describe("modules/mcp-tools", function () {
    beforeEach(function () {
      trail.clear();
    });

    afterEach(function () {
      trail.clear();
    });

    it("lists text grabs inline and image grabs as stubs", async function () {
      trail.append({
        ts: 1,
        kind: "text",
        text: "A grabbed sentence.",
        source: { paperId: "1/TEST", pageLabel: "3" },
      });
      trail.append({
        ts: 2,
        kind: "image",
        imageDataUrl: TINY_PNG,
        source: { paperId: "1/TEST", pageLabel: "4" },
      });
      const payload = toolJson(await callTool("list_grabs", {}));
      assert.equal(payload.watermark, trail.watermark);
      assert.lengthOf(payload.grabs, 2);
      const [text, image] = payload.grabs;
      assert.equal(text.text, "A grabbed sentence.");
      assert.notProperty(image, "text");
      assert.notProperty(image, "imageDataUrl");
      assert.equal(image.width, 1);
      assert.equal(image.height, 1);
      assert.isAbove(image.byte_size as number, 0);
    });

    it("filters by watermark for delta pulls", async function () {
      trail.append({
        ts: 1,
        kind: "text",
        text: "one",
        source: { paperId: "1/TEST" },
      });
      const watermark = trail.watermark;
      trail.append({
        ts: 2,
        kind: "text",
        text: "two",
        source: { paperId: "1/TEST" },
      });
      const payload = toolJson(
        await callTool("list_grabs", { since: watermark }),
      );
      assert.lengthOf(payload.grabs, 1);
      assert.equal(payload.grabs[0].text, "two");
      assert.equal(payload.watermark, trail.watermark);
    });

    it("keeps held watermarks valid across a trail clear", async function () {
      trail.append({
        ts: 1,
        kind: "text",
        text: "pre-clear",
        source: { paperId: "1/TEST" },
      });
      const held = toolJson(await callTool("list_grabs", {})).watermark;
      trail.clear();
      trail.append({
        ts: 2,
        kind: "text",
        text: "post-clear",
        source: { paperId: "1/TEST" },
      });
      const payload = toolJson(await callTool("list_grabs", { since: held }));
      assert.lengthOf(payload.grabs, 1);
      assert.equal(payload.grabs[0].text, "post-clear");
    });

    it("returns image payloads from get_grab as image content", async function () {
      const { grab } = trail.append({
        ts: 1,
        kind: "image",
        imageDataUrl: TINY_PNG,
        source: { paperId: "1/TEST", pageLabel: "4" },
      });
      const response = await callTool("get_grab", { grab_id: grab.id });
      const content = response.result?.content ?? [];
      assert.equal(content[0]?.type, "image");
      assert.isString(content[0]?.data);
    });

    it("refuses retrieval for papers not in the trail", async function () {
      const response = await callTool("get_paper", { paper_id: "1/NOPE" });
      assert.isTrue(response.result?.isError);
      const fetchResponse = await callTool("fetch_pdf", {
        paper_id: "1/NOPE",
      });
      assert.isTrue(fetchResponse.result?.isError);
    });
  });

  describe("modules/mcp-tools pngDimensions", function () {
    it("reads IHDR dimensions and rejects non-PNG data", function () {
      assert.deepEqual(pngDimensions(TINY_PNG), { width: 1, height: 1 });
      assert.isNull(pngDimensions("data:image/png;base64,"));
      assert.isNull(pngDimensions("data:text/plain,hello"));
    });
  });
});
