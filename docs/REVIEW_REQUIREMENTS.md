# Noteboard+ review requirements

Review the current application for concrete correctness, data integrity, isolation,
interaction and performance problems. Preserve the established visual style and
the behavior below. Tie each finding to a reproducible trigger and affected code.
Do not replace product requirements with generic UI preferences.

## Text and element editing

- Every area-creation tool follows the shared Lock in time setting; quick drags/clicks do not create ellipses, lines or other shapes when that delay is enabled. Freehand, Fill and Eraser retain their own gestures. Small-object resize handles use the visible size and board zoom.
- Rectangular selection offers Copy area, Paste into area and Merge area. Copies preserve editable objects. Merge creates one selectable object and layer entry, with existing guest/editor DOM identity preserved; transform/undo/redo/clone/preset/save/reopen/ungroup must retain members and original layer relationships. The group's supported controls must have real effects.
- Undo records meaningful document actions, including Alt cropping, board names and fill/grid appearance. Ignore identical updates without erasing a redo branch. Canvas interactions move keyboard focus out of previous text inputs while preserving legitimate text editing.
- Every paste action reads the current OS/browser clipboard. Native Windows file copies may be exposed as text/uri-list with FileNameW data; read actual current files, images and HTML/text without falling back to a remembered canvas copy. Batch media drops/pastes commit together and malformed files report failure.
- Native Web loads its real ad-block extension into a dedicated private runtime and shares that filter engine across isolated webpage sessions. Guest requests carry their own source URL and per-field preference, with no independent hidden matcher. Blocked resources must fail to contact the controlled test server; ordinary resources must load, Off must allow ads, and opposite settings in separate sessions must remain independent. Keep cosmetics/CSP/cookie/popup controls and guest isolation intact. Release idle extension resources without unloading live guests or allowed popups; reopening must restore blocking.

- Text scaling is opt-in. Resize the whole rich-text layout proportionally, like
  an image: wrapping, relative positions, headings, lists, inline font sizes,
  formatting, borders and spacing remain unchanged. Repeated resizes must not
  accumulate font/HTML rewrites. Turning the mode off preserves the current view
  and restores ordinary frame resizing and reflow. Persist the mode and scale
  through undo/redo, duplication, saving, reopening, templates and exports.
- Text remains editable and selectable when scaled. Colors and formatting apply
  only to the selected range when there is one. Preserve selection/caret through
  toolbar actions; the caret remains visible even with white text.
- Text accepts new content only within complete visible native line boxes, with
  capacity recalculated after frame, font, rule-spacing or scale changes. Rules
  off keeps normal native layout. Resizing smaller or enlarging the font retains
  excess canonical text hidden by whole rows; growing the field reveals it again,
  without deleting content, auto-expanding the frame or exposing overflow by scroll.
- True placement previews use the same geometry, style defaults, opacity and
  board/Section clipping as final elements, including line caps and triangle
  Sharp/Rounded joins. Lock in time delays both preview modes. Lines have a
  minimum length rather than a full-cell minimum in each axis; small offsets
  must not invent a new angle. Grid angle quantization stays consistent.
- Matching creation tools may move/resize only their own element types through
  their permission settings. Text defaults to editing/moving enabled; saved explicit
  disabled values remain authoritative. Other creation tools remain opt-in.
  Select works independently of Hand's permissions.
- Drawing, panning and manipulation must not select unrelated DOM text/media or
  reset video playback. Drawing assistance starts off unless enabled.

## Web and media

- Resizing Web changes the website's real viewport and responsive layout without
  reloading it or losing page input. App/window zoom and board zoom must not change
  the website's logical dimensions. Mouse input must still hit the visual target.
- Desktop/Tablet/Phone profiles agree across menus. Native Chromium configures
  dimensions, orientation, UA/client hints and touch capability before site scripts
  run. Device changes preserve the field's session; independent fields/clones use
  separate sessions. Browser iframe previews have explicit capability limits.
- Web Tool settings offer page control with Select and Hand. These preferences
  change input ownership without recreating/reloading the guest; element resize
  handles remain available. Drawing and locked fields never gain page control.
- Ads, cookies and popups must be enforced in native guest requests/frames/windows,
  including first-load and setting changes. Maintain safe sandboxing, context
  isolation, disabled page Node integration and trusted owner-checked IPC. Do not
  weaken browser security or claim a decorative switch provides enforcement.
- External sites such as YouTube must render/play with default blocking settings.
  Keep reliable loading, failure, retry and URL editing behavior. Use controlled
  fixtures for deterministic tests and distinguish external/provider failures.

## Boards, hierarchy and placement

- New Board is an additional board surface in the same workspace and Layers view,
  with the same editing/placement rules as Main Board; it is not a plain rectangle.
- Web, Media and New Board use the configured held area-placement gesture. A short
  click must not place an object when Lock time requires a drag/hold.
- Held area previews keep the same anchor when the pointer crosses either axis,
  including small snapped drags. Preview and release use identical snapping and
  geometry; clip at board edges without translating the anchor. A held Select
  area must not become an accidental click on a nearby object.
- Sections clip according to placement origin and hierarchy order: elements begun
  inside remain inside; elements begun outside lose the overlapping inside part.
  Recompute clipping after dependent sections/boards move, resize, change order,
  visibility or parentage. Rotation/flipping must keep clipping correct.
- Deleting in Layers preserves the current hierarchy view and scroll position.
  Do not reintroduce layer-to-layer reparenting controls.

## Menus, toolbar and zoom

- Keep compact, consistent menu rows, text centering and palette spacing. Avoid
  duplicate rules, separators, ineffective color controls or bottom Preview groups.
- The bottom property bar keeps its controls and rounded shell when overflowing;
  add a separate inset scrollbar row below, without squeezing or shifting controls.
- More uses a held drag handle and the same compact ghost as Edit Toolbar. Its green
  drop target keeps its position, hides the original dragged toolbar item, commits
  only a valid drop and cancels outside. Native web content must not swallow release.
- Ctrl+scroll defaults to cursor-anchored board zoom; shortcut and Cursor/Center
  preference are configurable and persistent. Preserve point anchoring at limits.

## Saving and review evidence

- Ctrl+C/Cut/Paste use the current system clipboard. A previously copied board
  object must not override newer OS text or media. Text editors and spreadsheet
  cells own their own clipboard and keyboard gestures.
- Native Web forwards the configured zoom shortcut over pages, video and nested
  frames; ordinary scrolling remains ordinary after modifier release. Cursor
  anchoring works through host zoom, board zoom and device emulation, up to 3200%.
  Fullscreen preserves the existing guest and playback. Consent popup lifecycles
  and background filter refresh must not throw in Electron's main process.
- Main/additional board resizing share Keep content in place. When enabled,
  adding/removing space leaves content stationary in the workspace; when disabled,
  that board's contents follow its moved origin. Independent boards stay stationary.
  Undo/redo restores both geometry and content; canceled Main Board resizing rolls back.
- Select has exactly Rectangle, Polygon and freehand Lasso variations, with no separate Polygon/Lasso toolbar or More entries. Older active tools/layouts migrate to Select while preserving the chosen variation. Polygon previews are open unfilled point/segment chains until explicitly closed.
- Polygon selection closes with Enter, a double click or the first vertex; Lasso
  follows a freehand gesture. Respect hidden/locked objects and visible Section
  clipping. Shift adds and Alt subtracts. Multi-selection moves, copies, duplicates,
  cuts and deletes coherently; grouped moves commit once and honor preview mode.
- Normal Polygon/Lasso completion retains the drawn contour and the ordinary
  area action bar. Copy/Merge use that contour's hits, including concave notches,
  and retain editable whole objects. Pasting fits editable contents to area bounds.
  Shift/Alt retain additive/subtractive object selection behavior.
- Alignment & spacing is a General Settings option. Show alignment, equal gaps and
  actual pixel distances to nearby objects, including diagonal neighbors and long
  gaps; snapping uses the existing object-snapping preference. Crop and Eyedropper
  have no toolbar or More entry, including migrated saved layouts. Alt cropping
  retains the source image/video, independent of ratio, and remains undoable.
- Rectangle, Lasso and Polygon share the configured Lock in time. Release before
  activation cancels; activation anchors at the live pointer. Polygon delays only
  its initial vertex and subsequent vertices remain clicks on an open chain.
- Spreadsheet previews and inline editing use the same renderer and viewport.
  Retain scroll/zoom and active worksheet, restore complete expanded menus, keep
  pending edits alive after deselection and prevent inactive frames from stealing
  focus. View-only changes create no canvas Undo; file export retains calculated
  formula results even when the editor was opened without changing values.
- The old Section-cell formula engine is replaced by workbook objects. Convert old
  data once on import, preserve cell values/formulas/styles, and discard old computed
  caches. Keep a single workbook snapshot through clone, history, save and export.
- Spreadsheet mode is chosen before creation: Advanced retains a scrollable viewport and full Edit spreadsheet; Simple shows the entire finite sheet including letter/number headers, with no off-screen extra rows/columns or expanded editor. Cell/header bounds are real usable window bounds; on-board titles/editor strips must not take away cell space. Simple creation/resize includes header offsets, and row/column sizing or insertion changes its actual bounds. Canvas Undo restores removed cells after shrinking.
- Advanced inline/expanded views retain one live workbook, selection and cell undo. The right panel reuses the complete engine ribbon and registered data/formatting panels, rather than a separate abbreviated command list. Canonical sidebar notifications must remain unchanged for plugins; presentation routing must render each panel once. Dropdowns/dialogs use the host document when docked and native document when expanded. Before creation, bottom cell-width/height controls set defaults; afterwards they edit only the selected workbook. Flush drafts when leaving; host-panel shortcuts/clipboard must not trigger canvas actions. Preserve legacy Advanced documents and unrelated boards/defaults.
- Spreadsheet editing has an explicit isolated input context. Cell selection, typing,
  Delete, Undo, range paste, sorting, filtering, validation and conditional formatting
  must not activate canvas gestures. Flush the current draft before Done and wait
  for formula results. Removing a filter must recalculate visibility-aware formulas.
- Use the OSS Univer engine and local workers; do not imply complete Excel format
  compatibility. XLSX exchange supports values, formulas and basic formatting/merges/
  dimensions; macros, charts and pivots are not provided. Import adds independent
  sheets without replacing existing data and handles name/ID collisions. Large valid
  workbook boards must round-trip through the normal portable archive limits.

- Save as offers Template, independent New Board and portable File. Remap references
  and sessions when cloning. Include media in archives; preserve rich text and editor
  settings. Async failures must not report success or create silent duplicate copies.
- Validate an entire bulk import before writes. Serialize writes, retain recovery
  behavior and preserve unrelated boards. Never publish local user data or secrets.
- Tests must run on isolated data/profiles. Use `npm run typecheck`, `npm test`,
  `npm run test:e2e` and `npm run test:desktop`; set `NOTEBOARD_LIVE_WEB_TEST=1` for
  the optional live provider test. A code review does not replace real UI testing.
- For native device screenshots use Electron `BrowserWindow.capturePage`:
  Playwright CDP screenshots can override/reset guest device metrics during capture.

## Persistence and failure contracts

- Both desktop IPC and the local HTTP server use `shared/board-store.js`. Validate the entire batch, unique IDs and all base revisions before writing its first file. Atomic file replacement retains the previous valid backup; a corrupt primary must not overwrite that backup. A batch is not a multi-file filesystem transaction if a later disk write fails.
- The acknowledged base revision is separate from the new save timestamp. Current editors send the acknowledged base over IPC, or `If-Match: "revision"` over HTTP; creation uses `If-None-Match: *`. Reject stale updates/deletions with a conflict even when their new timestamp is larger. Keep unsaved edits open for export/retry; never silently overwrite another editor's work. Identical acknowledged payload retries are idempotent.
- HTTP PUT/DELETE without a precondition return428; malformed or contradictory revision headers return400. Batch POST accepts `{pages, baseRevisions}` with an explicit acknowledged revision (or null for creation) for every ID. Legacy bare arrays remain create-only; they cannot overwrite existing boards by choosing a newer timestamp. Preflight failures happen before any batch write. Known validation, stale-revision and case-insensitive path-collision errors retain their structured codes over HTTP and native IPC; unknown I/O failures remain uncertain and retryable.
- All board-store entry points, including read-time recovery/migration, share a canonical directory lease across processes. Its sibling lock avoids waking the board-directory watcher. An expired lease can be recovered after a crash; a writer that loses ownership cannot acknowledge its mutation. Canonical loads scan once and unchanged boards are not rewritten.
- Reuse a revision for an unchanged full persisted payload, including workbook views. Retry an uncertain write exactly before its newer replacement; recovery replays an optional exact predecessor before the latest draft. A recovery-only browser write is not a disk acknowledgment. Definitive validation/conflict failures must not strand later drafts behind an obsolete retry. A conflict offers Save as and confirmed Reload saved version; stale callbacks from a discarded editor cannot restore its draft.
- Serialize editor saves, recovery replay and deletion. Import/create opens the editor after insertion succeeds. Keep the form/file available after a failed first insertion. Recovery retains its base revision, is removed only after acknowledgment, and cannot replace an equally new stored document silently.
- Recovery belongs to a document-lifetime owner, including duplicated tabs. An ordinary save/discard clears only its owner's draft; replay clears the exact loaded value after acknowledgment. Divergent or ambiguous legacy drafts become visible independent Recovered boards instead of overwriting or resurrecting an original. Deterministic copy IDs/origins make acknowledgment-loss retries preserve already edited recovered copies. I/O failures retain raw drafts and report the problem.
- Native close disables input while awaiting the current document flush and queued writes. Save failure/timeout restores input and offers Keep open by default. Browser unload uses a bounded keepalive request or a local recovery copy; failure to store a large recovery must not be reported as success.
- Discover backup-only boards. Migrate a stored ZIP to the JSON owner only after successful persistence, preserve the original ZIP under an inert recovery name, and do not reload that preserved archive after deletion.
- JSON files have a128MiB write/read limit. Portable archives enforce128MiB compressed/expanded and manifest budgets and64MiB per-media budgets, with export validation matching import. The128MiB manifest limit preserves existing archive compatibility (owner decision2026-10-24). Asset restoration applies only to media/image elements, never literal text beginning with `assets/`.
- A moved Page uses destination-local coordinates, preserves its Main surface color and cloned relationships, and leaves additional surfaces outside Main as peers. If copying succeeds but source deletion fails, both copies stay visible and the failure is reported.
