# chat-pane

## ADDED Requirements

### Requirement: Pane resizes and closes cleanly

The pane's splitter SHALL trade width only between the PDF and the pane, leaving no gap between them. The pane SHALL reopen at its last width, and closing it SHALL give the PDF the full width of the tab.

#### Scenario: Dragging the splitter back and forth

- **WHEN** the user drags the splitter left to widen the pane, then right to narrow it
- **THEN** the PDF grows to meet the splitter, with no empty space between them

#### Scenario: Closing the pane

- **WHEN** the user closes the pane after resizing it
- **THEN** the PDF fills the whole tab
