# Noteboard+

Desktop whiteboard and spatial note-taking application built with Electron, React, Vite, and TypeScript.

## Highlights

- Spatial boards, nested boards, layers, drawing, media, links, web fields, presets, and package import/export.
- Section spreadsheets created from one or many existing Sections, or from a blank grid preset.
- Safe formulas, row/column operations, fill and series automations, configurable shortcuts, keyboard navigation, and persistent sheet settings.
- Shared validation and bounded archive/file handling across the browser server and Electron desktop runtime.
- Save as Template, an independent New Board, or a portable ZIP file with embedded media.
- Full Web pages in Electron and supported YouTube video embeds in browser previews.
- Optional Text scaling preserves the complete rich-text layout during proportional resizing; switch it off to resume normal frame resizing and wrapping.

## Architecture

- `src/features/board/` owns immutable board cloning, package placement, document history, hierarchy indexing, and migration.
- `src/features/spreadsheet/` owns the Section spreadsheet model, formulas, automations, shortcuts, accessibility, and settings panel.
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
