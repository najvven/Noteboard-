# Noteboard+

Current version: **1.0.7**. See [release notes and known validation limits](docs/RELEASE-1.0.7.md).

Desktop whiteboard and spatial note-taking application built with Electron, React, Vite, and TypeScript.

## Highlights

- Spatial boards, nested boards, layers, drawing, media, links, web fields, presets, and package import/export.
- Spreadsheet objects with a full workbook editor: formulas, multiple sheets, formatting, sorting, filtering, validation and conditional formatting. Cell input is isolated from canvas gestures; formula calculation and file exchange use local workers.
- XLSX/CSV/TSV import adds sheets without overwriting the current workbook. XLSX export covers values, formulas and basic cell formatting, merges and dimensions; CSV exports the current sheet. Existing Section spreadsheets migrate into the new workbook format.
- Select has exactly three modes: Rectangle, freehand Lasso and Polygon. All three share Lock in time; Polygon delays its initial anchor, then accepts clicked vertices until explicitly closed. Editable area actions, groups and Alt cropping remain available. Alignment & spacing lives in General Settings and shows alignment and actual pixel gaps; Crop and Eyedropper are removed from the tool inventory.
- Choose Advanced or Simple before creating a spreadsheet. Advanced keeps a viewport into a larger workbook, with scrolling and Edit spreadsheet. Simple displays its whole finite sheet, including A/B/C and 1/2/3 headers; its bounds derive from actual rows, columns and their sizes. On-board windows reserve their full area for cells and headers. Shrinking a Simple sheet removes outside rows/columns; canvas Undo restores them.
- The contextual right panel reuses Univer's full live ribbon and registered validation/formatting panels. Advanced inline/expanded views share one workbook, cell selection and undo history. Cell dimensions are defaults before creation and affect only the selected sheet afterwards. Host-panel input and clipboard gestures stay separate from canvas shortcuts.
- Spreadsheet thumbnails use the actual cell renderer at the object's viewport size. Selection preserves the same layout and scroll position; the expanded editor restores its complete menus. Inactive thumbnail renderers cannot take keyboard focus, started actions complete after deselection, and derived view changes do not consume canvas Undo.
- Shared validation and bounded archive/file handling across the browser server and Electron desktop runtime.
- Save as Template, an independent New Board, or a portable ZIP file with embedded media.
- Full Web pages in Electron and supported YouTube video embeds in browser previews.
- Cursor-anchored zoom up to 3200%, including Ctrl+scroll over native Web content; native video fullscreen preserves playback. Main and additional boards share a switch for keeping content fixed during resizing.
- Optional Text scaling preserves the complete rich-text layout during proportional resizing; switch it off to resume normal frame resizing and wrapping.
- Selection-area actions copy editable objects, paste the current system clipboard into the chosen area, or merge contents and their source layers into one movable, scalable object. Ungroup restores the original layers; merged content keeps its Web guest and input state. Board format4 retains compatibility with older documents and prevents older builds from silently editing the new group semantics.
- All area creation tools honor Lock in time. Document Undo/Redo covers crop/transform gestures, clipboard imports, grouping, board names, fill and grid appearance; identical updates do not consume an Undo.
- Native Web loads a bundled **Noteboard Ad Block** extension using Ghostery2.18.2 and verified maintained filter lists. Its private runtime shares one filter engine across fields; each website keeps its own session, switches and request source. Unused runtimes are released after idle cleanup. Electron guest requests are forwarded to the actual loaded extension; Web settings show real status/counts. Cosmetic, cookie and popup enforcement remains isolated per Web session. Ordinary browser previews cannot enforce native filtering inside cross-origin frames.

## Architecture

- `src/features/board/` owns immutable board cloning, package placement, document history, hierarchy indexing, and migration.
- `src/features/spreadsheet/` owns workbook snapshots, finite-grid geometry, legacy conversion, the isolated Univer editor and local workers. `SpreadsheetElement.tsx` coordinates one inline/expanded session; `sheet-ribbon.tsx` and `sheet-overlays.tsx` reuse its UI in the host panel. `scripts/univer-host-popovers.mjs` applies a checked build-time compatibility fix for pinned Univer 1.0.2 popover containers, without changing installed modules.
- `src/features/toolbar/`, `src/features/web/`, and `src/features/home/` contain focused UI-domain models.
- `shared/` contains runtime-neutral validation, persistence, archive streaming, security, and site-boundary adapters used by the server and Electron shell.
- `src/components/BoardEditor.tsx` remains the interaction coordinator while delegating reusable domain work to those modules.

## Development

Requirements: Node.js 20 or newer.

```powershell
npm install
npm run electron:dev
```

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run test:desktop
npm audit --audit-level=high
```

Desktop tests use isolated temporary profiles and offscreen windows. Set
`$env:NOTEBOARD_LIVE_WEB_TEST='1'` before `npm run test:desktop` to include live
YouTube playback; the default desktop checks use local fixtures.

## Windows installer

```powershell
npm run make
```

The installer is written to `release/`. Desktop board data is stored under Electron's per-user application-data directory. Use **Show in files** in the board menu to open the exact folder.

## Review criteria

The accepted behavior and regression checklist are in [docs/REVIEW_REQUIREMENTS.md](docs/REVIEW_REQUIREMENTS.md).
Repository configuration is prepared for CodeRabbit, Greptile and Qodo. Those services
must be connected to the repository before they can produce external reviews.
