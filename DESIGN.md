# Design notes

This is Zotero Context's design spec:
a vision document recording the user-facing design decisions and the research and rationale behind them,
independent of any release timeline.
Shortcuts are written as text (`Ctrl`, `Cmd`, `Option`, `Shift`) throughout;
**accel** means the platform's primary command modifier: Ctrl on Windows/Linux, Cmd on macOS.

## Keyboard shortcuts: the quote-key leader

Zotero Context's hotkeys are **leader sequences**: two presses in a row, never three keys held at once.
First press the two-key prefix chord `Ctrl+'` (Windows/Linux) or `Cmd+'` (macOS),
then tap the action letter as its own keypress within 2 seconds.
The modifier may be released or kept held through the letter; both fire the action.

| Action           | Windows/Linux | macOS     | Second-letter mnemonic |
| ---------------- | ------------- | --------- | ---------------------- |
| Toggle grab mode | `Ctrl+' G`    | `Cmd+' G` | **G**rab               |
| Copy bundle      | `Ctrl+' B`    | `Cmd+' B` | **B**undle             |
| Full recap       | `Ctrl+' R`    | `Cmd+' R` | **R**ecap              |
| Clear trail      | `Ctrl+' X`    | `Cmd+' X` | X = delete/clear       |
| Paper intro      | `Ctrl+' I`    | `Cmd+' I` | **I**ntro              |

Why the quote key:
the plugin's whole output is quotes (grabbed sentences paste as `> blockquoted` text with citations),
so "press _quote_, then _grab_" reads naturally.
It is also the only mnemonic key that survived the availability sweep below:
verified unbound in Zotero core (library, reader, note editor), in every surveyed plugin, and in Chrome,
and it types nothing while a text field has focus.
Ergonomically the prefix sits under the right hand (`'` is home-row pinky)
while the action letters sit mostly under the left, so sequences alternate hands.

Escape or a 2-second timeout cancels an armed prefix;
any other key cancels it and passes through untouched, so an abandoned prefix never eats typed text.
The action letter itself is swallowed (it selects the action; it must not also type).
While armed, Escape is consumed: it does not additionally exit grab mode or close reader popups.

### Requirements

These came out of iterating on the design (v0.1 shipped Windows-only `Ctrl+Alt+<letter>` chords):

1. **Work while typing.**
   Sequences must fire while focus is in a text field (note editor, annotation comment, search box, a chat composer).
   Requiring a click-out is worse than a longer chord.
2. **Short.** At most 1–2 buttons in the prefix; no three-modifier chords.
3. **Symmetric across platforms.** Same shape and length on Windows, Linux, and macOS.
4. **No `Alt+<letter>` on Windows.**
   Microsoft's [interaction guidelines](https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard) say:

   > Don't use Alt+alphanumeric key combinations for shortcut keys.
   > Such shortcut keys may conflict with access keys.

   Zotero's menubar is always visible on Windows
   and its access keys are **locale-dependent** (en-US: Alt+F/E/V/G/T/H; German: Alt+B is _Bearbeiten_…),
   so no letter can be proven safe.

5. **Portable to an internet browser extension**: the same gestures should be usable on claude.ai in Chrome.
6. **Intuitive**: chords should mean something, the way `Ctrl+C` means copy.
7. Avoid combos with strong foreign muscle memory even when technically free (e.g. `Ctrl+R` = browser reload).
8. **No finger gymnastics.**
   Sequences must be comfortable on a QWERTY keyboard:
   a left-hand prefix such as `Ctrl+E`/`Cmd+E` sets you up for awkward same-hand hops to action letters like X and R,
   while a right-hand prefix lets the (mostly left-hand) action letters alternate hands.

### Availability research

Summarized from a source-level audit (July 2026) of `zotero/zotero`, `zotero/reader`, `zotero/note-editor`,
~40 Zotero plugins (all keybinding-relevant mainstream plugins plus the LLM/AI niche),
Chrome's documented shortcuts, and the Chrome extension `commands` API.

#### Zotero core

- **Reader** (the surface this plugin lives in):
  `Ctrl+Alt+G` / `Cmd+Option+G` focuses the go-to-page box, which broke v0.1's grab-mode chord.
  `Ctrl+Alt+1–5` (Mac: `Control+Option+1–5`) create annotations from a selection;
  `Alt/Option+1–8` switch annotation tools;
  plain `H`, `S`, `R`, `L`, `1–8` are tool/read-aloud keys;
  `accel+F/G/A/Z/P/=/-/0` are find/undo/print/zoom;
  `Ctrl+Alt+P`, `accel+O`, `accel+S` are swallowed anti-pdf.js guards.
  Notably the reader matches its Alt shortcuts by **physical key code**
  because macOS Option rewrites `ev.key` (Option+G types `©`; Option+I/U are dead keys);
  this plugin does the same.
- **Library**: the configurable `keys.*` shortcuts all live on `accel+Shift+<letter>`
  (A C F I K L N O R S T X Y …), making that family a minefield.
  The item list uses type-to-jump on bare letters.
- **Note editor** (inside reader tabs): `accel+B/I/U/K` are bold/italic/underline/link;
  `Ctrl+Alt+C` (Win) / `Cmd+Ctrl+C` (Mac) inserts a citation;
  Mac `Control+Option+1–9` set headings.

#### Plugin ecosystem

Default shortcuts of surveyed plugins, **compiled 2026-07-29** from each plugin's source/README;
defaults change over time, so re-verify before leaning on this table:

| Plugin                               | Default shortcuts                                             | Scope            |
| ------------------------------------ | ------------------------------------------------------------- | ---------------- |
| Translate for Zotero (PDF Translate) | `Ctrl+T`                                                      | reader + library |
| Zotero GPT                           | `Ctrl+/` (in its panel: `Ctrl+R`, `Ctrl+S`, `Esc`)            | main + reader    |
| PapersGPT                            | `accel+Enter`                                                 | reader           |
| A.R.I.A. (ai-research-assistant)     | `Shift+R`                                                     | main window      |
| Beaver                               | `accel+J`, `accel+Shift+J`                                    | global           |
| Seer-AI                              | `accel+Shift+S`                                               | global           |
| Immersive Translate BabelDOC         | `accel+Shift+B`, `accel+Shift+H`                              | library          |
| ZoteroOllama                         | `accel+Shift+G` (in its dialog: `accel+S/T/M/K/L/F/C/E`)      | library          |
| zotero-ai-explain                    | `accel+Shift+E`, `accel+Shift+L`                              | reader / global  |
| zotero-ai-sidebar                    | bare reader keys (`Enter`, `Space`, `/`, `H`), off by default | reader           |
| Better Notes                         | `/` or `accel+/`                                              | note editor      |
| Better BibTeX                        | none of its own (rides Zotero's `accel+Shift+C` quick copy)   | library          |
| Zutilo                               | none by default (user-assignable; Zotero 7 shortcuts broken)  | library          |
| Actions & Tags                       | none by default (fully user-defined)                          | any              |

Also surveyed, with **no default shortcuts**: llm-for-zotero (panel-scoped
keys only), Zotero AI Butler, Zotero Style, MarkDB-Connect, zotero-mcp,
ZotSeek, AIdea, Garden for Zotero, paper-chat-for-zotero,
kazgu/zotero-chatgpt, Zotero-RAG, zotero-ai-summary, zotero-ai-collection,
deepseek-copilot-for-zotero, zotero-ainote, zotero-ai-tab,
zotero-paper-outline, zotero-ai-bar, zotero-ai-assistant, Zotero-Cat,
zotero-ai-tags, pdf-ai-bookmarks, zotero-fulltext-translate,
Zotero-Research-Copilot, zotero-copilot, Night for Zotero (discontinued).

Takeaways: no plugin binds `accel+'` or any quote-key chord;
the crowded namespace is `accel+Shift+<letter>`;
zero plugins default to `Ctrl+Alt+<letter>`.
No LLM plugin overlaps this plugin's purpose (they embed chat inside Zotero; this plugin ferries context out).

#### Chrome (for the browser extension)

- `accel+'` is unbound in Chrome on both platforms;
  a content script on claude.ai can capture it and run the same leader state machine.
- Hard-reserved (uninterceptable) combos to stay clear of:
  `accel+T/N/W` (+Shift variants), `Ctrl+Tab`/`Ctrl+PgUp/PgDn`, and on macOS `Cmd+Q/M/H/\``;
  none conflict with the leader.
- The extension `commands` API cannot express the prefix
  (it allows only `A–Z`, `0–9`, comma, period, and a few navigation keys,
  requires Ctrl or Alt, and forbids `Ctrl+Alt` outright),
  so the browser extension will implement the leader as a content-script `keydown` listener
  rather than a manifest `suggested_key`.

#### Operating systems

- **macOS reserved**: `Cmd+Option+Esc/H/D/M/W/Space`, `Cmd+Q/M/H/W`, `Ctrl+Space` etc.;
  none touch `Cmd+'` or bare letters-after-prefix.
- **Windows AltGr**: AltGr reports as Ctrl+Alt,
  so `Ctrl+Alt+<letter>` chords shadow typing on many European layouts
  (`AltGr+X` = `ź` on Polish, `AltGr+B` = `{` on Czech/Hungarian).
  The leader avoids the family entirely.
- **Dead keys**: on macOS `Option+I/U/E/N` are dead keys; irrelevant here since the prefix uses accel, not Option.
  On the Windows US-International layout `'` alone is a dead key,
  but `Ctrl+'` chords are unaffected (flagged for a runtime smoke test).

### Families considered and rejected

| Family (Win / Mac)                 | Why not                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Shift+<letter>`                   | It _is_ typing (capitals): dead inside text fields, violating requirement 1                                                                                       |
| `Alt+<letter>` / `Option+<letter>` | Windows menu access keys, locale-dependent (requirement 4), despite being the emptiest family in Chrome                                                           |
| `accel+<letter>` single chords     | Only R and J are free inside editors (everything else is copy/paste/undo/bold/…); R is browser-reload muscle memory; not enough letters for five mnemonic actions |
| `Control+<letter>` literal on Mac  | macOS emacs bindings in every text field (Ctrl+A/E/K/Y); and its Windows mirror is the crowded accel family                                                       |
| `Ctrl+Alt` / `Cmd+Option` chords   | v0.1's scheme: three keys per action, AltGr typing collisions, `Ctrl+Alt+G` broken by Zotero's own reader, forbidden in Chrome's `commands` API                   |
| `accel+Shift+<letter>`             | Three keys, and the one namespace Zotero core and plugins have already carved up                                                                                  |

A leader keeps every gesture at "one 2-key chord, one letter",
concentrates the collision surface into a single chord,
and frees the second letter to be purely mnemonic;
that is how G survived as "grab" even though `Ctrl+Alt+G` and `Cmd+G` are both taken as chords.

### Known caveats

- **Non-US layouts**: matching is by physical key position (`ev.code`),
  so the prefix is "the key right of `L`/`;`", labeled `Ä` on German QWERTZ and `ù` on French AZERTY.
  Docs call it the quote key;
  a bindings preference is on the backlog for layouts where that position is inconvenient.
- **`Cmd+'` vs `Cmd+;`**: Zotero binds `accel+;` (show all tabs) one key away.
  Mistypes open the tabs menu; harmless.
- **Flagged runtime checks**: `Ctrl+'` on the Windows US-International layout (dead-key apostrophe),
  and that nothing in a future Zotero release claims `accel+'`.
