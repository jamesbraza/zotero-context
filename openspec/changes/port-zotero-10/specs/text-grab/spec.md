# text-grab

## MODIFIED Requirements

### Requirement: Sentence-snap hover highlight

While grab mode is active, the plugin SHALL highlight the sentence under the cursor as a single unit (across line wraps, hyphenation, and column/page breaks), computed from Zotero's Structured Document Text (layout-model blocks in reading order) and sentence segmentation, mapped to page geometry by the reader. Running headers, footers, and page numbers (SDT excluded flow) SHALL NOT be snap targets. Segments SHALL be computed once per reader and indexed per page.

#### Scenario: Hovering a wrapped sentence

- **WHEN** grab mode is active and the cursor hovers any word of a sentence that spans three rendered lines
- **THEN** all three line fragments of that sentence highlight together as one unit

#### Scenario: Sentence crossing a page break

- **WHEN** a sentence starts at the bottom of one page and ends at the top of the next
- **THEN** hovering it on either page highlights that page's fragment, and grabbing it yields the whole sentence

#### Scenario: Running header

- **WHEN** the cursor hovers a running header or page number
- **THEN** no sentence highlight is shown

### Requirement: Graceful degradation without sentence geometry

If structured text is unavailable for a document (adapter failure, password-protected or failed extraction, no text), sentence-snap SHALL disable itself for that reader session without crashing, leaving area grab available; it SHALL NOT keep re-triggering extraction or swallow clicks while unavailable. A transient miss (reader view not created yet) SHALL be retried.

#### Scenario: Document without structured text

- **WHEN** grab mode is active on a document whose structured text cannot be produced
- **THEN** the user is told text snap is unavailable and clicks perform area grabs
