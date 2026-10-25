# Noteboard+ 1.0.8

This release applies the final fixes from the 1.0.7 technical report and keeps the installed app name as **Noteboard+**. The installer artifact is **Noteboard+ Setup.exe**. The installer wizard uses the existing app logo at its original aspect ratio, cropped to the requested side-panel dimensions.

## Corrections

- Corrupt primary JSON is parsed before it can rotate over a valid backup, including stores without a schema-specific validator.
- Template additions, renames and deletions use serialized operations shared across Electron and HTTP processes. Retrying an uncertain write uses the same ID. Whole-array replacement was removed to prevent stale clients from silently overwriting concurrent edits.
- Template save dialogs remain available when the server writes data but the response is lost. Save as reuses the same candidate ID on retry, avoiding duplicate boards or templates.
- File and clipboard imports retain their parsed board candidate until acknowledgment. A retry resends the same cloned elements and ID; if another process took the source ID, storage refreshes and a retry creates an independent copy.
- A stale template rename after another process deletes that template resolves with the shared current list. It does not pin the pending-operation queue ahead of later template changes.
- ZIP-only legacy boards participate in board ownership and revision checks before migration; deleted boards cannot reappear from their ZIP copy.
- Legacy Layer records receive their normalized `content` value before canonical storage and write acknowledgment.
- Native cosmetic ad filters run in guest subframes. A build-time compatibility check patches the pinned Ghostery preload only when its expected frame guard is present; Electron frame handlers validate ownership, URL and lifecycle, then apply filters to that specific frame.
- The recovery interaction fixture now edits existing visible text while preserving the accepted hidden overflow, instead of entering a new 70,000-character value that violates the text-row limit.
- Restored spreadsheet cell editing places the formula/text caret after the recovered draft, preventing the next keystroke from being inserted at the beginning after an iframe reload.
- The desktop Simple spreadsheet raster assertion allows the documented two-pixel platform rounding while keeping exact workbook and object dimensions as semantic checks.

## Validation

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm test` passes: 336 tests.
- Three focused browser regressions pass for failed/lost-ack import retries and deleted-template queue recovery; two spreadsheet draft scenarios, including formula caret recovery, pass across iframe reloads.
- The Electron Web test confirms cosmetic ad rules hide a test slot in both the page and its iframe, and that both become visible when the blocker is switched off.
- The existing coverage thresholds remain unchanged. Current coverage is 61.67% lines, 77.39% branches and 54.61% functions; the 80% coverage gate remains open.

No installer was run against the user's normal Windows profile. The packaged app is checked for user data and stable application identity before delivery.
