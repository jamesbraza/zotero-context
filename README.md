# Zotero Context

[![repo status][repostatus-badge]][repostatus-site]
[![zotero target version][zotero-badge]][zotero-site]
[![Using Zotero Plugin Template][template-badge]][template-repo]
![ci][ci-badge]

A [Zotero][zotero-site] plugin to ferry context for active readers.

When reading a paper and chatting with an AI (claude.ai, Claude Desktop, ChatGPT, ...),
getting context into the chat is arduous:
precisely selecting text, positioning screenshot boxes, remembering section and figure numbers,
and downloading/uploading/introducing the PDF itself.
Zotero Context turns each of those into a click or a hotkey.

Unlike plugins that embed an AI chat inside Zotero,
this plugin has no chat UI, no API keys, and no model calls.
It ferries context to whichever chat you already use, via the clipboard.

## Features

Everything revolves around **grab mode** in the PDF reader: click the
![grab mode button (⌖)](docs/grab-mode-button.svg) button
in the reader toolbar (or press `Ctrl+Alt+G`), and the cursor becomes a crosshair.

- **Sentence snap**: hover text and the sentence under the cursor glows;
  click to copy it as quoted text.
  `Shift`-click a later sentence to extend the grab through a range.
  No drag-selection needed.
- **Two-click area grab**: click two opposite corners of a figure, table, or formula
  to copy that region as an image. `Esc` cancels a pending corner.
- **Provenance on every grab**: the first grab from a paper carries its full citation;
  later grabs carry a compact locator
  (section names come from the PDF outline, embedded or Zotero-generated,
  with page-only fallback).
  A first and a second text grab paste as:

  ```text
  From "Attention Is All You Need" (Vaswani et al. 2017), §Encoder and Decoder Stacks, p. 3:
  > Encoder: The encoder is composed of a stack of N = 6 identical layers. ...

  §Attention, p. 4:
  > An attention function can be described as mapping a query and a set of key-value pairs ...
  ```

  Image grabs carry the same provenance as a caption strip rendered into the image itself,
  since chat inputs take only the image from a mixed paste. A grabbed figure arrives as:

  ![A grabbed figure with the provenance caption strip along the bottom](docs/image-grab-example.svg)

- **Session bundle**: grabs accumulate in an in-memory trail.
  `Ctrl+Alt+B` copies everything since your last bundle as one text block
  (image grabs cycle onto the clipboard with repeated presses).
  `Ctrl+Alt+Shift+B` copies a full-session recap for seeding a fresh chat;
  `Ctrl+Alt+X` clears the trail.
- **Paper intro**: `Ctrl+Alt+I` puts the paper's PDF file on the clipboard;
  pasting into claude.ai attaches it.
  Press again within a minute for an intro message (citation + abstract) to open the chat with.
- **Scanned PDFs**: sentence snap degrades to per-line snap targets automatically.
  Detection is character-exact: the plugin aligns the extracted sentence text against the
  PDF's glyph geometry unit by unit (absorbing ligatures and dehyphenated line breaks),
  and when the two can't be reconciled (typical for OCR'd text layers),
  it distrusts sentence boundaries and offers visual lines instead,
  which are derived from glyph positions alone.

### Hotkeys

| Hotkey             | Action                                            |
| ------------------ | ------------------------------------------------- |
| `Ctrl+Alt+G` or ⌖  | Toggle grab mode in the focused reader tab        |
| Click              | Grab hovered sentence (or place an area corner)   |
| `Shift`+click      | Extend the text grab through the clicked sentence |
| `Esc`              | Cancel pending corner, then exit grab mode        |
| `Ctrl+Alt+B`       | Copy bundle of grabs since last bundle            |
| `Ctrl+Alt+Shift+B` | Copy full-session recap                           |
| `Ctrl+Alt+X`       | Clear the session trail                           |
| `Ctrl+Alt+I`       | Copy paper PDF; press again for the intro message |

### Limitations (current)

- Grabs are ephemeral: nothing is written to your library, and the trail resets with Zotero.
- Hotkeys are fixed for now; preferences for bindings and press-and-hold are planned.
- Element-picking (click a figure to auto-bound it) and an MCP server for pull-style
  delivery are on the roadmap; see `openspec/changes/add-context-ferry/` for the full plan.

## Installation

- Encouraged: install in-app via the [Zotero Addons][zotero-addons] plugin marketplace
- Manual:
  1. Download the latest `.xpi` from [this repo's GitHub Releases][releases]
  2. install it via Zotero's Tools → Plugins menu

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE).
Built from [zotero-plugin-template][template-repo].

[ci-badge]: https://github.com/jamesbraza/zotero-context/actions/workflows/ci.yml/badge.svg
[releases]: https://github.com/jamesbraza/zotero-context/releases
[repostatus-badge]: https://www.repostatus.org/badges/latest/wip.svg
[repostatus-site]: https://www.repostatus.org/#wip
[template-badge]: https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github
[template-repo]: https://github.com/windingwind/zotero-plugin-template
[zotero-addons]: https://github.com/syt2/zotero-addons
[zotero-badge]: https://img.shields.io/badge/Zotero-9-green?style=flat-square&logo=zotero&logoColor=CC2936
[zotero-site]: https://www.zotero.org
