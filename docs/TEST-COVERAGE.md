# Combined test coverage

Run the full local test inventory and merge its coverage with:

```sh
npm run test:coverage:all
```

The command runs typecheck, source tests, browser tests, the production build, all Playwright interactions, and native Electron tests. It keeps an inventory of individual tests and their files alongside the result. The aggregate keeps the existing 80% gate for lines, branches, functions, and statements. A below-threshold run still writes the reports and returns a failure status.

The percentages are weighted from one merged Istanbul coverage map. Node and Electron main-process profiles are source-mapped by c8. Playwright and Electron window-renderer profiles are converted from Chromium V8 ranges to source-mapped Istanbul data, then merged by file, statement, function, and branch identity. Source maps are enabled only for the coverage build. Coverage from generated build files, dependencies, and test files is excluded; every application source file matching the explicit include paths is present, including unexecuted files.

Each run is stored under `.tmp/coverage-aggregate/<run-id>/`. `README.md` lists the executed cases, `coverage-inventory.json` records their names and a SHA-256 inventory of the exact code/test snapshot, `report/index.html` provides per-file detail, and `report/coverage-final.json` is machine-readable. The raw profiles are retained so the totals can be recalculated without repeating the test suites:

```sh
npm run test:coverage:report
```

The report command checks the source snapshot before reusing profiles. Make a new full run when the source or tests change. The Chromium extension worker is not attached to the page profiler; its source stays in the included file inventory and reports uncovered unless a worker profile becomes available.

## Latest verified aggregate

Run `20261025T155316227Z-331c9f26` (`.tmp/coverage-aggregate/20261025T155316227Z-331c9f26/`):

| Phase | Result |
| --- | --- |
| Typecheck | Passed |
| Source tests | 401 passed, 0 failed |
| Browser tests | 10 passed, 0 failed |
| Production build | Passed |
| Playwright | 153 passed, 0 failed; 151 tests captured application code |
| Electron | 33 passed, 1 skipped (optional live-YouTube test), 0 failed |

Combined coverage: **85.39% lines/statements, 85.74% branches, and 81.21% functions**. All unchanged 80% aggregate gates passed. The inventory recorded six required phases exactly once, no unknown suite states, and no profile collection failures.

Source/test snapshot SHA-256: `d997456896bae3dd07278acc314ff6ebb738d1e08803fdc9e58f3f914546bd23`  
Coverage-tool SHA-256: `6514a7544c5d02f22a38dafa21b26880075d893c921b89c4f60bc0539ce67ced`

This is the combined multi-runtime result. The separate `npm run test:coverage` command remains a source-only Node test run; use `npm run test:coverage:all` for the browser and Electron aggregate.
