# grab-provenance

## ADDED Requirements

### Requirement: Every grab carries a provenance header

Every grab (text or image) SHALL carry a plain-markdown provenance header identifying its source paper and location. Headers SHALL be renderable as plain text so they degrade gracefully in any chat client.

#### Scenario: Header present on image grab

- **WHEN** an area grab is delivered to the clipboard
- **THEN** an accompanying text header identifies the paper and page of the captured region

### Requirement: Full citation on first grab, compact locator after

The first grab from a given paper within a session SHALL use a full citation header built from the item's metadata (at minimum title, authors, year) plus location. Subsequent grabs from the same paper in the same session SHALL use a compact locator of the form section and page (e.g. `§4.3.2, p. 16`).

#### Scenario: First grab of a session

- **WHEN** the user makes their first grab from a paper this session
- **THEN** the header contains the full citation and the location

#### Scenario: Tenth grab of a session

- **WHEN** the user makes a subsequent grab from the same paper
- **THEN** the header is a compact locator (section and/or page), not the full citation

#### Scenario: Second paper joins the session

- **WHEN** the user opens a cited paper in another reader tab and grabs from it for the first time
- **THEN** that grab gets the new paper's full citation header, and later grabs from either paper use compact locators tied to their own paper

### Requirement: Section resolution with page-only fallback

The section component SHALL be resolved by mapping the grab's position into the PDF's outline. When the PDF has no outline or resolution fails, the header SHALL fall back to page-only, and the grab SHALL never be blocked or delayed by section resolution.

#### Scenario: PDF without an outline

- **WHEN** the user grabs from a PDF that has no embedded outline
- **THEN** the grab is delivered immediately with a page-only locator
