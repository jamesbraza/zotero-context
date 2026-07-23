# clipboard-delivery

## ADDED Requirements

### Requirement: Immediate per-grab copy

Each grab SHALL be written to the system clipboard immediately upon capture: text grabs as provenance header plus quoted text; image grabs as a native pasteable image with the provenance header rendered as a caption strip inside the image (rich paste targets take only the image flavor from a mixed clipboard — verified against claude.ai and Word). The user SHALL be able to paste into a chat directly after each grab with no intermediate step.

#### Scenario: Text grab pastes as quote with header

- **WHEN** the user grabs a sentence and pastes into claude.ai
- **THEN** the pasted content is the provenance header followed by the quoted sentence

#### Scenario: Image grab pastes as image with embedded provenance

- **WHEN** the user completes an area grab and pastes into claude.ai
- **THEN** an image of the captured region is attached to the chat input, with the provenance header legible as a caption strip within the image

### Requirement: Session bundle copy

The plugin SHALL provide a session-bundle action that composes all session grabs (or all grabs since the last bundle copy) into a single clipboard payload honoring the one-action invariant. The bundle SHALL deliver as a text bundle (with inline markers standing in for image grabs) plus sequential image copies, and the multi-step delivery SHALL be communicated to the user. (Mixed HTML-with-embedded-images composition was ruled out empirically — spike S1: rich chat inputs drop images embedded in an HTML paste; single-action image batching is the MCP pull path's job.)

#### Scenario: Bundle with images

- **WHEN** the user copies a bundle of two text grabs and one image grab
- **THEN** the first paste carries the texts with an inline marker locating the image, and the
  bundle action then cycles the captioned image onto the clipboard for a follow-up paste,
  telling the user how many images remain

### Requirement: Paper intro copy

The plugin SHALL provide a per-item "copy paper intro" action producing a chat-opening blurb: full citation, abstract when available, and a note that the PDF is attached. Where platform support for clipboard file transfer is verified, the action SHALL also place the PDF file on the clipboard.

#### Scenario: Starting a session

- **WHEN** the user triggers the paper-intro action and pastes into a fresh chat
- **THEN** the chat input receives the citation and abstract blurb suitable as an opening message
