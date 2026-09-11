# grab-mode

## ADDED Requirements

### Requirement: Entering and exiting grab mode

The plugin SHALL provide a grab mode in the Zotero reader that can be entered and exited via a reader toolbar button and via a toggle hotkey — the leader sequence `Ctrl+' G` (`Cmd+' G` on macOS), matched by physical key position. (A user-configurable press-and-hold semantics is planned but not required for v0.1 — tracked in the tasks backlog.)

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

#### Scenario: Escape resolves an armed leader prefix first

- **WHEN** grab mode is active, a leader prefix (`Ctrl+'` / `Cmd+'`) is armed, and the user presses Escape
- **THEN** the pending prefix is cancelled and grab mode stays active (a second Escape exits as usual)

### Requirement: Visible mode indication

The plugin SHALL visibly indicate whenever grab mode is active, via at least the toolbar button state and a changed cursor over the document.

#### Scenario: Indicator reflects state

- **WHEN** grab mode activates or deactivates
- **THEN** the toolbar button state and cursor update immediately to match

### Requirement: Quiet feedback

Grab mode SHALL confirm each successful grab with a transient in-place visual flash over the grabbed geometry (the grabbed sentence range for text grabs; the captured region for area grabs), rendered against the document's current scroll/zoom position at the moment of confirmation. Grab mode SHALL NOT show informational toasts (activation, readiness, or per-grab success); toasts are reserved for failures.

#### Scenario: Success confirms in place

- **WHEN** a text or area grab completes delivery to the clipboard
- **THEN** a brief flash appears over the grabbed content at its current on-screen position and fades away, and no success toast is shown

#### Scenario: Failures still toast

- **WHEN** a grab cannot complete (e.g. the region cannot be rendered or the item cannot be resolved)
- **THEN** a failure toast is shown

### Requirement: Non-interference with normal reading

Grab mode SHALL NOT alter Zotero's native selection, annotation, or navigation behavior when inactive, and SHALL remove all of its overlays and listeners from the reader when deactivated, except that a grab-confirmation flash already fading MAY complete its fade (bounded by its fade duration) before removing itself.

#### Scenario: Clean deactivation

- **WHEN** grab mode is deactivated
- **THEN** no hover highlights, preview rectangles, or grab click-handlers remain active, and native reader interactions behave as stock Zotero (a confirmation flash mid-fade may finish fading first)
