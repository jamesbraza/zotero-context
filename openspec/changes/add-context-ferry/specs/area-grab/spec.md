# area-grab

## ADDED Requirements

### Requirement: Two-click rectangular capture

While grab mode is active, the plugin SHALL support capturing a rectangular region via two clicks: the first click anchors one corner, a preview rectangle then tracks the cursor, and the second click completes the capture. No press-and-hold drag SHALL be required.

#### Scenario: Capturing a figure

- **WHEN** the user clicks above-left of a figure and then clicks below-right of it
- **THEN** an image grab of the enclosed region is created and handed to delivery

#### Scenario: Cancelling mid-capture

- **WHEN** the user has placed the first corner and presses Escape (or exits grab mode)
- **THEN** the pending capture is discarded and no grab is created

### Requirement: Faithful image rendering

The captured region SHALL be rendered to a PNG image from the page's rendered content at a resolution sufficient for legibility of formulas and axis labels (at least the reader's current rendering scale), and SHALL stay within common chat upload limits (≤5 MB per image).

#### Scenario: Formula legibility

- **WHEN** the user captures a display formula at 100% zoom
- **THEN** the resulting PNG is at least as legible as the on-screen rendering

### Requirement: Ephemerality

Area grabs SHALL NOT create, modify, or leave behind Zotero annotations or any other persistent trace in the library or the PDF.

#### Scenario: Library unchanged after grabs

- **WHEN** the user performs several area grabs and then inspects the item's annotations and sync state
- **THEN** no new annotations or item modifications exist
