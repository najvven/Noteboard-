# Noteboard+ 1.0

This release publishes the fixed public version **1.0**. The packaged
application remains named **Noteboard+**; installer and application version
labels use **1.0**. The installer file is **Noteboard+ Setup.exe**. Windows
requires a four-part numeric resource version internally (`1.0.0.0`); that
resource value is not used as the user-facing release label.

The setup wizard uses the application logo at its original proportions on a
white sidebar. It crops the logo to the installer panel rather than stretching
it. The application ID, installation identity, and per-user board-data
location are preserved.

The final installer is `C:\Users\Pawel\Documents\Codex\Noteboard+\Installer\Noteboard+ Setup.exe` (139,220,841 bytes; SHA-256
`6D931CA6FFF6BE1FEA0097BF1393A4DF4EE1D3C6495F2CBBA5B9F9392CF5AA74`). Its
packaged `app.asar` contains the application but no user boards or settings.
The prior installer and previous clean-source folder are retained in
`Source/.tmp/task30/`.

The refreshed clean source is `C:\Users\Pawel\Documents\Codex\NoteboardWork`:
285 files / 15,341,598 bytes, hash-matched to the current source files, with
dependencies, build output, local state and board data excluded.

## Audit corrections

- Board storage keeps logical board ownership separate from physical file
  aliases, preserves recovery copies across failed writes/deletes, validates
  preconditions consistently, and keeps exact import/save retries idempotent.
- Spreadsheet import/export bounds real ZIP expansion and merged-cell work,
  preserves cached formula values, styles, empty records and declared columns,
  and keeps rich-text drafts and ready workbook history intact.
- Cell-size changes account for every explicit row/column dimension and
  auto-height row without creating no-op history entries.
- Web fields retain pending navigation intent until commit, render the saved
  viewport dimensions exactly, apply updated privacy settings to open popups,
  and fail closed when a top-level cookie context has no network origin.
- Section clipping also constrains unselected pointer hit regions; nested
  child sections do not clip their parent. Internal text links use one
  case-insensitive prefix parser while preserving case-sensitive element IDs.
- Spreadsheet ribbon hosts clean up nodes left by a prior iframe generation.
  E2E fixtures isolate retry attempts, and CI now runs the complete browser
  interaction suite.

## Validation

- `npm run typecheck`: passed.
- `npm test`: passed, 382 tests.
- `npm run test:browser`: passed, 10 tests.
- `npx playwright test`: passed, 151 tests.
- `npm run test:desktop`: passed, 28 tests; the live YouTube playback case was
  skipped because it requires `NOTEBOARD_LIVE_WEB_TEST=1`.
- Production build and Windows installer packaging: passed. The installer
  version label is `1.0`; package metadata retains the valid semver `1.0.0`,
  and Windows' numeric product-version resource uses `1.0.0.0`.
- Packaged startup: launched the built Windows app with a fresh temporary
  profile and confirmed the `My Workspace` window rendered. The Electron ESM
  entrypoint now registers readiness callbacks without blocking on top-level
  `await app.whenReady()`.
- Coverage remains below the unchanged 80% gates: 62.49% lines, 77.48%
  branches and 55.66% functions. The coverage command exits non-zero; the gate
  remains an open validation limitation and was not lowered.
- Vite reports the generated spreadsheet chunk at about 7.5 MB (minified),
  above its 500 kB warning threshold. This is a build warning, not a build
  failure.
