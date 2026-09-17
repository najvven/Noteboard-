# Noteboard+ review requirements

Review the current application for concrete correctness, data integrity, isolation,
interaction and performance problems. Preserve the established visual style and
the behavior below. Tie each finding to a reproducible trigger and affected code.
Do not replace product requirements with generic UI preferences.

## Text and element editing

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
