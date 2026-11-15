# text-grab

## ADDED Requirements

### Requirement: Sentence-snap hover highlight

While grab mode is active, the plugin SHALL highlight the sentence under the cursor as a single unit (across line wraps, hyphenation, and column/page breaks where geometry allows), computed from Zotero's structured document text and sentence segmentation.

#### Scenario: Hovering a wrapped sentence

- **WHEN** grab mode is active and the cursor hovers any word of a sentence that spans three rendered lines
- **THEN** all three line fragments of that sentence highlight together as one unit

#### Scenario: Sentence crossing a page break

- **WHEN** a sentence starts at the bottom of one page and ends at the top of the next
- **THEN** hovering it on either page highlights that page's fragment, and grabbing it yields the whole sentence

#### Scenario: No text under cursor

- **WHEN** the cursor hovers a region with no extractable text (e.g. a figure bitmap)
- **THEN** no sentence highlight is shown

### Requirement: Running headers and footers are not snap targets

Running headers, running footers, and page numbers SHALL NOT be sentence-snap targets.

#### Scenario: Hovering a running header

- **WHEN** grab mode is active and the cursor hovers a running header or page number
- **THEN** no sentence highlight is shown

### Requirement: Click to grab a sentence

Clicking a highlighted sentence SHALL produce a text grab containing the sentence's text (dehyphenated, reading order) and its source position (page, rects), without requiring any drag gesture.

#### Scenario: Single click grabs

- **WHEN** the user clicks a highlighted sentence
- **THEN** a text grab of exactly that sentence is created and handed to delivery (per clipboard-delivery and grab-trail specs)

### Requirement: Shift-click extends the selection

Shift-clicking another sentence on the same page SHALL extend the pending text grab to the contiguous range of sentences between the first-clicked and shift-clicked sentences, in reading order. A shift-click on a different page SHALL grab the clicked sentence alone (cross-page ranges are a possible future extension).

#### Scenario: Extending to a neighboring sentence

- **WHEN** the user clicks sentence A, then shift-clicks sentence C two sentences later
- **THEN** the text grab contains sentences A through C in reading order

### Requirement: Graceful degradation without sentence geometry

If structured text or segmentation is unavailable for a document (adapter failure, failed or password-protected extraction, no text), sentence-snap SHALL disable itself for that reader session without crashing, leaving area grab available.

#### Scenario: Scanned page

- **WHEN** grab mode is active on a page with no text layer
- **THEN** no hover highlights appear, no error is raised, and two-click area grab still works

#### Scenario: Structured text still being built

- **WHEN** grab mode is active on a document whose structured text Zotero is still building
- **THEN** clicks perform area grabs, and sentence snap starts once the text is ready

#### Scenario: Document without structured text

- **WHEN** grab mode is active on a document whose structured text cannot be produced
- **THEN** the user is told text snap is unavailable, and clicks perform area grabs
