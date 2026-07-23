/** Thin wrappers over the toolkit clipboard, so flavor strings and chaining
 * live in one place. Throws propagate to the interaction-boundary guard. */

export function copyText(text: string) {
  new ztoolkit.Clipboard().addText(text, "text/unicode").copy();
}

export function copyImage(pngDataUrl: string, textFlavor?: string) {
  const clipboard = new ztoolkit.Clipboard().addImage(pngDataUrl);
  if (textFlavor) clipboard.addText(textFlavor, "text/unicode");
  clipboard.copy();
}

export function copyFileWithText(path: string, text: string) {
  new ztoolkit.Clipboard().addFile(path).addText(text, "text/unicode").copy();
}
