# Noteboard+

Desktop whiteboard and spatial note-taking application built with Electron, React, Vite, and TypeScript.

## Highlights

- Spatial boards, nested boards, layers, drawing, media, links, web fields, presets, and package import/export.
- Section spreadsheets created from one or many existing Sections, or from a blank grid preset.
- Safe formulas, row/column operations, fill and series automations, configurable shortcuts, keyboard navigation, and persistent sheet settings.
- Shared validation and bounded archive/file handling across the browser server and Electron desktop runtime.

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
npm audit --audit-level=high
```

## Windows installer

```powershell
npm run make
```

The installer is written to `release/`. Desktop board data is stored under Electron's per-user application-data directory. Use **Show in files** in the board menu to open the exact folder.
