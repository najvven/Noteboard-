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
- Native Web must load its real ad-block extension into the correct Web session. Guest requests use the loaded extension's matcher, with no independent hidden substitute. Blocked resources must fail to contact the controlled test server; ordinary resources must load, Off must allow ads, and opposite settings in separate sessions must remain independent. Keep cosmetics/CSP/cookie/popup controls and guest isolation intact.

- Text scaling is opt-in. Resize the whole rich-text layout proportionally, like
  an image: wrapping, relative positions, headings, lists, inline font sizes,
  formatting, borders and spacing remain unchanged. Repeated resizes must not
  accumulate font/HTML rewrites. Turning the mode off preserves the current view
  and restores ordinary frame resizing and reflow. Persist the mode and scale
  through undo/redo, duplication, saving, reopening, templates and exports.
- Text remains editable and selectable when scaled. Colors and formatting apply
  only to the selected range when there is one. Preserve selection/caret through
  toolbar actions; the caret remains visible even with white text.
- Matching creation tools may move/resize only their own element types through
  explicit opt-in settings. Select works independently of Hand's permissions.
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
- Polygon selection closes with Enter, a double click or the first vertex; Lasso
  follows a freehand gesture. Respect hidden/locked objects and visible Section
  clipping. Shift adds and Alt subtracts. Multi-selection moves, copies, duplicates,
  cuts and deletes coherently; grouped moves commit once and honor preview mode.
- Smart Guides show actual alignment and distances, and snapping uses the existing
  object-snapping preference. Crop retains the source image/video and resizes its
  crop independently of ratio. Native Eyedropper samples the actual rendered pixel
  inside the app and applies the chosen supported color property.
- The old Section-cell formula engine is replaced by workbook objects. Convert old
  data once on import, preserve cell values/formulas/styles, and discard old computed
  caches. Keep a single workbook snapshot through clone, history, save and export.
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
