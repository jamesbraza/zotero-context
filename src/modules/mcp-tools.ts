/**
 * MCP tool surface over the grab trail (spec: mcp-delivery; design D7).
 *
 * Identity is the trail, never reader state: every retrieval tool serves
 * only papers the user has grabbed from this session — the server
 * structurally cannot browse the wider library or filesystem.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { version } from "../../package.json";
import type { HttpRequest, HttpResponse } from "../adapter/http-server";
import { dataUrlBase64, dataUrlBytes } from "../adapter/reader";
import {
  formatCaption,
  formatHeader,
  formatTextGrab,
  type PaperInfo,
} from "../core/provenance";
import type { GrabTrail } from "../core/trail";
import type { Grab } from "../core/types";

/**
 * Stateful session singletons + item access, injected by the caller. The
 * lazy handler bundle (src/mcp-handler.ts) bundles its OWN copies of every
 * module it imports, so grab-session state must cross the bundle boundary
 * as values from the main bundle — a static import here would silently
 * serve a second, always-empty trail.
 */
export interface McpDeps {
  trail: GrabTrail;
  /** Live citation-metadata map by paperId (grab-session's instance). */
  paperInfos: ReadonlyMap<string, PaperInfo>;
  itemForPaperId: (paperId: string) => Zotero.Item | null;
  fieldText: (
    item: Zotero.Item,
    field: Parameters<Zotero.Item["getField"]>[0],
  ) => string;
}

/** Contract between the lazy handler bundle and the eager server shell. */
export type McpRequestHandler = (
  deps: McpDeps,
  req: HttpRequest,
  port: number,
  auth: string,
) => Promise<HttpResponse>;

declare const IOUtils: {
  stat: (path: string) => Promise<{ size: number }>;
};

type ToolResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  isError?: boolean;
};

const errorResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

const jsonResult = (payload: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

const notInTrail = (paperId: string) =>
  errorResult(
    `Paper ${paperId} is not in the grab trail. Tools serve only papers ` +
      `grabbed this session — ask the user to grab from the paper first, ` +
      `or call list_grabs for available papers.`,
  );

/** Width/height from a PNG data URL's IHDR chunk; null when unreadable. */
export function pngDimensions(
  dataUrl: string,
): { width: number; height: number } | null {
  const base64 = dataUrlBase64(dataUrl);
  if (!base64) return null;
  let head: string;
  try {
    // 48 base64 chars → 36 bytes: signature (8) + IHDR length/type (8) +
    // width (4) + height (4) fit comfortably
    head = atob(base64.slice(0, 48));
  } catch {
    return null;
  }
  if (head.length < 24 || head.charCodeAt(1) !== 0x50 /* 'P' */) return null;
  const be32 = (offset: number) =>
    (head.charCodeAt(offset) << 24) |
    (head.charCodeAt(offset + 1) << 16) |
    (head.charCodeAt(offset + 2) << 8) |
    head.charCodeAt(offset + 3);
  return { width: be32(16), height: be32(20) };
}

function paperSummary(deps: McpDeps, paperId: string) {
  const info = deps.paperInfos.get(paperId);
  return info
    ? { title: info.title, authors: info.creatorSummary, year: info.year }
    : undefined;
}

/** Listing entry: text grabs inline in full, image grabs as stubs (D7). */
function listEntry(deps: McpDeps, grab: Grab) {
  const base = {
    id: grab.id,
    kind: grab.kind,
    paper_id: grab.source.paperId,
    page: grab.source.pageLabel,
    section: grab.source.section,
  };
  if (grab.kind === "text") return { ...base, text: grab.text };
  const info = deps.paperInfos.get(grab.source.paperId);
  return {
    ...base,
    caption: info ? formatCaption(grab.source, false, info) : undefined,
    ...(grab.imageDataUrl
      ? {
          ...pngDimensions(grab.imageDataUrl),
          byte_size: dataUrlBytes(grab.imageDataUrl),
        }
      : {}),
  };
}

async function bestPdfPath(
  item: Zotero.Item,
): Promise<{ path: string; size: number } | { error: string }> {
  // A standalone PDF is its own trail paper (see paperInfoFromItem), and
  // getBestAttachment throws on non-regular items — same guard as paper-intro
  const attachment = item.isAttachment()
    ? item
    : (await item.getBestAttachment()) || null;
  if (!attachment || !attachment.isPDFAttachment()) {
    return { error: "Paper has no PDF attachment in Zotero." };
  }
  const path = await attachment.getFilePathAsync();
  if (!path) {
    return { error: "PDF attachment file is not present on disk." };
  }
  const { size } = await IOUtils.stat(path);
  return { path, size };
}

// Tool configs at module scope: built once, not per request (a fresh
// McpServer is created per stateless request; its tool wiring is cheap but
// schema/description construction need not repeat)
const LIST_GRABS_CONFIG = {
  description:
    "List the session's grab trail from the user's Zotero reader: " +
    "passages and figure regions the user marked while reading, in " +
    "capture order with provenance (paper, page, section). Text grabs " +
    "are returned inline; image grabs are stubs — fetch their pixels " +
    "with get_grab. Returns a watermark: pass it back as `since` next " +
    "call to receive only newer grabs.",
  inputSchema: {
    paper_id: z.string().optional().describe("Only grabs from this paper"),
    since: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Watermark from a previous call: only newer grabs"),
  },
};

const GET_GRAB_CONFIG = {
  description:
    "Full payload of one grab by id (see list_grabs). Image grabs " +
    "return the captured region as an image with a provenance caption.",
  inputSchema: { grab_id: z.string() },
};

const GET_PAPER_CONFIG = {
  description:
    "Metadata and abstract for a paper in the grab trail (cheap; use " +
    "fetch_pdf for the document itself).",
  inputSchema: { paper_id: z.string() },
};

const FETCH_PDF_CONFIG = {
  description:
    "Local file path of a trail paper's PDF — read it directly; " +
    "targeted page reads beat ingesting the whole document.",
  inputSchema: { paper_id: z.string() },
};

/** Build a fully tool-equipped MCP server (one per request — stateless).
 * State comes from `deps` (see McpDeps): never import grab-session here. */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "zotero-context", version });
  const { trail } = deps;

  server.registerTool(
    "list_grabs",
    LIST_GRABS_CONFIG,
    ({ paper_id, since }) => {
      let grabs = trail.listSince(since ?? 0);
      if (paper_id !== undefined) {
        grabs = grabs.filter((g) => g.source.paperId === paper_id);
      }
      const papers: Record<string, unknown> = {};
      for (const g of grabs) {
        papers[g.source.paperId] ??= paperSummary(deps, g.source.paperId);
      }
      return jsonResult({
        watermark: trail.watermark,
        papers,
        grabs: grabs.map((g) => listEntry(deps, g)),
      });
    },
  );

  server.registerTool("get_grab", GET_GRAB_CONFIG, ({ grab_id }) => {
    const grab = trail.get(grab_id);
    if (!grab) return errorResult(`No grab with id ${grab_id}.`);
    const info = deps.paperInfos.get(grab.source.paperId);
    if (grab.kind === "image" && grab.imageDataUrl) {
      const base64 = dataUrlBase64(grab.imageDataUrl);
      if (!base64) return errorResult("Image payload is unreadable.");
      return {
        content: [
          { type: "image", data: base64, mimeType: "image/png" },
          ...(info
            ? [
                {
                  type: "text" as const,
                  text: formatCaption(grab.source, true, info),
                },
              ]
            : []),
        ],
      };
    }
    if (grab.kind === "text" && grab.text !== undefined) {
      const header = info ? formatHeader(grab.source, true, info) : "";
      return {
        content: [{ type: "text", text: formatTextGrab(header, grab.text) }],
      };
    }
    return errorResult("Grab has no payload.");
  });

  server.registerTool("get_paper", GET_PAPER_CONFIG, ({ paper_id }) => {
    if (!trail.papers().includes(paper_id)) return notInTrail(paper_id);
    const item = deps.itemForPaperId(paper_id);
    if (!item) return errorResult(`Zotero item ${paper_id} not found.`);
    return jsonResult({
      paper_id,
      ...paperSummary(deps, paper_id),
      date: deps.fieldText(item, "date"),
      abstract: deps.fieldText(item, "abstractNote"),
      doi: deps.fieldText(item, "DOI"),
      url: deps.fieldText(item, "url"),
    });
  });

  server.registerTool("fetch_pdf", FETCH_PDF_CONFIG, async ({ paper_id }) => {
    if (!trail.papers().includes(paper_id)) return notInTrail(paper_id);
    const item = deps.itemForPaperId(paper_id);
    if (!item) return errorResult(`Zotero item ${paper_id} not found.`);
    const pdf = await bestPdfPath(item);
    if ("error" in pdf) return errorResult(pdf.error);
    return jsonResult({ path: pdf.path, byte_size: pdf.size });
  });

  return server;
}
