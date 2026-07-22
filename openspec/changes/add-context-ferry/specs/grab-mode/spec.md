# grab-mode

## ADDED Requirements

### Requirement: Entering and exiting grab mode

The plugin SHALL provide a grab mode in the Zotero reader that can be entered and exited via a reader toolbar button and via a press-once toggle hotkey. (A user-configurable press-and-hold semantics is planned but not required for v0.1 — tracked in the tasks backlog.)

#### Scenario: Toggle via toolbar button

- **WHEN** the user clicks the grab-mode toolbar button while reading
- **THEN** grab mode activates, and clicking the button again deactivates it

#### Scenario: Toggle hotkey

- **WHEN** the user presses the grab-mode hotkey while reading, and presses it again later
- **THEN** grab mode activates on the first press and deactivates on the second, with one
  physical press never toggling more than once (presses can be delivered from both the main
  window and the reader iframe)

#### Scenario: Escape exits

- **WHEN** grab mode is active (toggle semantics) and the user presses Escape
- **THEN** grab mode deactivates and any in-progress grab (e.g. a first area-grab corner) is cancelled

### Requirement: Visible mode indication

The plugin SHALL visibly indicate whenever grab mode is active, via at least the toolbar button state and a changed cursor over the document.

#### Scenario: Indicator reflects state

- **WHEN** grab mode activates or deactivates
- **THEN** the toolbar button state and cursor update immediately to match

### Requirement: Non-interference with normal reading

Grab mode SHALL NOT alter Zotero's native selection, annotation, or navigation behavior when inactive, and SHALL remove all of its overlays and listeners from the reader when deactivated.

#### Scenario: Clean deactivation

- **WHEN** grab mode is deactivated
- **THEN** no hover highlights, preview rectangles, or grab click-handlers remain active, and native reader interactions behave as stock Zotero
