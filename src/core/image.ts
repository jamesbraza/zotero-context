/**
 * Image utilities for grabs. Uses only standard web APIs (canvas), with the
 * Document passed in so this stays free of host globals.
 */

const STRIP_FONT_PX = 13;
const STRIP_PAD_PX = 6;

/**
 * Return a new PNG data URL with a thin caption strip appended below the
 * image. Rich chat targets take only the image flavor from a mixed paste
 * (spike S1 follow-up), so image grabs carry provenance inside their pixels.
 */
/** Caption strip line cap. */
export const STRIP_MAX_LINES = 4;

export async function addCaptionStrip(
  doc: Document,
  pngDataUrl: string,
  caption: string,
): Promise<string> {
  const img = await loadImage(doc, pngDataUrl);
  // Scale strip with image density so the caption stays legible at any zoom
  const scale = Math.max(1, img.width / 800);
  const fontPx = STRIP_FONT_PX * scale;
  const padPx = STRIP_PAD_PX * scale;

  const measure = doc.createElement("canvas");
  const mctx = measure.getContext("2d") as unknown as CanvasRenderingContext2D;
  mctx.font = `${fontPx}px sans-serif`;
  const lines = wrapToWidth(mctx, caption, img.width - 2 * padPx);

  const lineHeight = Math.ceil(fontPx * 1.25);
  const stripHeight = Math.ceil(lines.length * lineHeight + 2 * padPx);

  const canvas = doc.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height + stripHeight;
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, img.height, canvas.width, stripHeight);
  ctx.fillStyle = "#f5f5f5";
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(
      line,
      padPx,
      img.height + padPx + i * lineHeight + lineHeight / 2,
    );
  });
  return canvas.toDataURL("image/png");
}

/** Word-wrap into at most STRIP_MAX_LINES lines; ellipsize the last one. */
export function wrapToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const [i, word] of words.entries()) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === STRIP_MAX_LINES - 1) {
      // Last allowed line: gather the rest and ellipsize if needed
      const rest = words.slice(i).join(" ");
      lines.push(truncateToWidth(ctx, rest, maxWidth));
      return lines;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function loadImage(doc: Document, src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = doc.createElement("img");
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("caption strip: image load failed"));
    img.src = src;
  });
}

/** Trim to fit maxWidth with a trailing ellipsis. */
export function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}
