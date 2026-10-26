# Combined test coverage

Run the full local test inventory and merge its coverage with:

```sh
npm run test:coverage:all
```

The command runs typecheck, source tests, browser tests, the production build, all Playwright interactions, and native Electron tests. It keeps an inventory of individual tests and their files alongside the result. The aggregate keeps the existing 80% gate for lines, branches, functions, and statements. A below-threshold run still writes the reports and returns a failure status.

The percentages are weighted from one merged Istanbul coverage map. Node and Electron main-process profiles are source-mapped by c8. Playwright and Electron window-renderer profiles are converted from Chromium V8 ranges to source-mapped Istanbul data, then merged by file, statement, function, and branch identity. Source maps are enabled only for the coverage build. Coverage from generated build files, dependencies, and test files is excluded; every application source file matching the explicit include paths is present, including unexecuted files.

The GitHub `coverage` job runs this aggregate on Node 24 under Xvfb, installs Chromium/Chrome, and keeps all four 80% gates. It uploads the inventory, phase logs, profiler status, LCOV and summary even after a failure. The standalone `npm run test:coverage` command remains the source-only diagnostic; it is no longer the multi-runtime CI gate.

Each run is stored under `.tmp/coverage-aggregate/<run-id>/`. `README.md` lists the executed cases, `coverage-inventory.json` records their names and a SHA-256 inventory of the exact code/test snapshot, `report/index.html` provides per-file detail, and `report/coverage-final.json` is machine-readable. The raw profiles are retained so the totals can be recalculated without repeating the test suites:

```sh
npm run test:coverage:report
```

The report command checks the source snapshot before reusing profiles. Make a new full run when the source or tests change. The Chromium extension worker is not attached to the page profiler; its source stays in the included file inventory and reports uncovered unless a worker profile becomes available.

The verified aggregate writes `coverage/lcov.info` from the same Istanbul map used for the thresholds. `sonar-project.properties` points SonarCloud to that LCOV and the original JavaScript/TypeScript sources. The GitHub scan runs only when `SONAR_TOKEN`, `SONAR_ORGANIZATION`, and `SONAR_CI_BASED=true` are configured and the aggregate step succeeds. A failed suite still uploads its diagnostics, but the workflow does not submit partial coverage to SonarCloud. SonarCloud must be set to CI-based analysis for JS/TS coverage to be imported; the workflow cannot change this project setting. A missing configuration therefore skips the scanner with a visible message rather than fabricating coverage. Coverage upload alone does not resolve a separate Reliability Quality Gate failure.

## Latest verified aggregate

Run `20261025T195051958Z-d85b96ea` (`.tmp/coverage-aggregate/20261025T195051958Z-d85b96ea/`):

| Phase | Result |
| --- | --- |
| Typecheck | Passed |
| Source tests | 417 passed, 0 failed |
| Browser tests | 11 passed, 0 failed |
| Production build | Passed |
| Playwright | 154 passed, 0 failed; 152 tests captured application code |
| Electron | 36 passed, 1 skipped (optional live-YouTube test), 0 failed |

Combined coverage: **85.68% lines/statements, 85.42% branches, and 80.29% functions**. All unchanged 80% aggregate gates passed. The inventory recorded six required phases exactly once, no unknown suite states, and no profile collection failures.

Source/test snapshot SHA-256: `5eb3aa45c4e52203b5d838b26d38128e19fceda698ed5d4e204a786ef8eb5161`  
Coverage-tool SHA-256: `25158b44f09c27ee4b0df283376b38307604ddd566b37a786023be7af883f134`

Profiles: Node **142**, Chromium **152**, Electron renderer **42** across **35** instrumented app runs plus one expected shutdown. There were zero profiler collection errors, zero unmapped source profiles and zero failed suites. `coverage/lcov.info` contains 112 original-source entries (565,905 bytes); it includes no test, dist, or dependency paths. `npm run test:coverage:report` reproduced the same totals from this snapshot.

This is the combined multi-runtime result. The separate `npm run test:coverage` command remains a source-only Node test run; use `npm run test:coverage:all` for the browser and Electron aggregate.
