# Noteboard+

Desktop whiteboard and spatial note-taking application built with Electron, React, Vite, and TypeScript.

## Highlights

- Spatial boards, nested boards, layers, drawing, media, links, web fields, presets, and package import/export.
- Spreadsheet objects with a full workbook editor: formulas, multiple sheets, formatting, sorting, filtering, validation and conditional formatting. Cell input is isolated from canvas gestures; formula calculation and file exchange use local workers.
- XLSX/CSV/TSV import adds sheets without overwriting the current workbook. XLSX export covers values, formulas and basic cell formatting, merges and dimensions; CSV exports the current sheet. Existing Section spreadsheets migrate into the new workbook format.
- Polygon selection, freehand Lasso, group operations, Smart Guides with distances, lossless image/video cropping and a desktop pixel Eyedropper.
- Shared validation and bounded archive/file handling across the browser server and Electron desktop runtime.
- Save as Template, an independent New Board, or a portable ZIP file with embedded media.
- Full Web pages in Electron and supported YouTube video embeds in browser previews.
- Cursor-anchored zoom up to 3200%, including Ctrl+scroll over native Web content; native video fullscreen preserves playback. Main and additional boards share a switch for keeping content fixed during resizing.
- Optional Text scaling preserves the complete rich-text layout during proportional resizing; switch it off to resume normal frame resizing and wrapping.
- Selection-area actions copy editable objects, paste the current system clipboard into the chosen area, or merge contents and their source layers into one movable, scalable object. Ungroup restores the original layers; merged content keeps its Web guest and input state. Board format4 retains compatibility with older documents and prevents older builds from silently editing the new group semantics.
- All area creation tools honor Lock in time. Document Undo/Redo covers crop/transform gestures, clipboard imports, grouping, board names, fill and grid appearance; identical updates do not consume an Undo.
- Native Web loads a bundled **Noteboard Ad Block** extension using Ghostery2.18.2 and verified maintained filter lists. Electron guest requests are forwarded to that loaded extension for actual request decisions; its status/counts are shown in Web settings. Cosmetic, cookie and popup enforcement remains isolated per Web session. Ordinary browser previews cannot enforce native filtering inside cross-origin frames.

## Architecture

- `src/features/board/` owns immutable board cloning, package placement, document history, hierarchy indexing, and migration.
- `src/features/spreadsheet/` owns workbook snapshots, legacy data conversion, the isolated Univer editor and its formula/file workers. `SpreadsheetElement.tsx` coordinates the board preview and editor dialog.
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
