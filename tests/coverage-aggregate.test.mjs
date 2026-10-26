import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COVERAGE_TOOL_FILES,
  assertCoverageBuildSucceeded,
  assertNodeTestPhaseHasPassingTests,
  assertCoverageSuitesKnown,
  assertCoveragePhaseInventory,
  coverageSuiteStatus,
  collectCoverageSourceInventory,
  electronCoverageCollectionErrors,
  deduplicatePlaywrightAttempts,
  hashCoverageToolFiles,
  parseNodeTestStatuses,
  validateLcovSourcePaths,
  REQUIRED_COVERAGE_PHASES,
  validateReportOnlySnapshot,
} from '../scripts/coverage-aggregate-helpers.mjs';

test('report-only accepts matching fingerprints and hashes, and rejects stale source or tool snapshots', async () => {
  const previous = {
    fingerprint: 'a'.repeat(64),
    coverageToolSha256: 'b'.repeat(64),
  };
  assert.doesNotThrow(() => validateReportOnlySnapshot(previous, { ...previous }));
  assert.throws(
    () => validateReportOnlySnapshot(previous, { ...previous, fingerprint: 'c'.repeat(64) }),
    /Source or test files have changed/,
  );
  assert.throws(
    () => validateReportOnlySnapshot(previous, { ...previous, coverageToolSha256: 'd'.repeat(64) }),
    /coverage-tool hash is missing or coverage tool files have changed/,
  );
  assert.throws(
    () => validateReportOnlySnapshot({ fingerprint: previous.fingerprint }, previous),
    /coverage-tool hash is missing or coverage tool files have changed/,
  );

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-coverage-tool-'));
  try {
    await fs.mkdir(path.join(root, 'scripts'));
    for (const relative of COVERAGE_TOOL_FILES)
      await fs.writeFile(path.join(root, relative), `initial ${relative}`);
    const initialToolHash = await hashCoverageToolFiles(root);
    await fs.writeFile(path.join(root, 'scripts/coverage-aggregate-helpers.mjs'), 'changed helper');
    const helperChangedHash = await hashCoverageToolFiles(root);
    assert.notEqual(helperChangedHash, initialToolHash, 'the helper implementation must be part of the tool hash');
    await fs.writeFile(path.join(root, 'scripts/run-coverage-aggregate.mjs'), 'changed runner');
    assert.notEqual(await hashCoverageToolFiles(root), helperChangedHash, 'the runner implementation must be part of the tool hash');
    await fs.rm(path.join(root, 'scripts/coverage-aggregate-helpers.mjs'));
    await assert.rejects(hashCoverageToolFiles(root), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('coverage snapshot includes page, style, source, test, and build-script inputs and changes when files are added or removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-coverage-inputs-'));
  const required = [
    'index.html', 'sheet.html', 'src/index.css', 'main.js', 'preload.cjs',
    'web-privacy-preload.cjs', 'server.ts', 'package.json', 'package-lock.json',
    'playwright.config.ts', 'vite.config.ts', 'tsconfig.json', 'sonar-project.properties',
  ];
  try {
    await fs.mkdir(path.join(root, 'shared'), { recursive: true });
    for (const relative of [...required, 'src/app.tsx', 'scripts/build-native-assets.mjs', 'scripts/univer-host-popovers.mjs', 'tests/e2e/test.ts']) {
      const absolute = path.join(root, relative);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, `initial ${relative}`);
    }
    const initial = await collectCoverageSourceInventory(root);
    const paths = new Set(initial.files.map(file => file.path));
    for (const relative of ['index.html', 'sheet.html', 'src/index.css', 'scripts/build-native-assets.mjs', 'scripts/univer-host-popovers.mjs', 'tests/e2e/test.ts'])
      assert.ok(paths.has(relative), `${relative} must be part of the source snapshot`);

    for (const relative of ['index.html', 'sheet.html', 'src/index.css', 'scripts/build-native-assets.mjs']) {
      const absolute = path.join(root, relative);
      const original = await fs.readFile(absolute, 'utf8');
      await fs.writeFile(absolute, `${original} changed`);
      const changed = await collectCoverageSourceInventory(root);
      assert.notEqual(changed.fingerprint, initial.fingerprint, `changing ${relative} must stale report-only coverage`);
      await fs.writeFile(absolute, original);
    }

    const added = path.join(root, 'scripts/new-build-step.mjs');
    await fs.writeFile(added, 'new build step');
    assert.notEqual((await collectCoverageSourceInventory(root)).fingerprint, initial.fingerprint, 'added build inputs must change the snapshot');
    await fs.rm(added);
    const removed = path.join(root, 'scripts/univer-host-popovers.mjs');
    await fs.rm(removed);
    assert.notEqual((await collectCoverageSourceInventory(root)).fingerprint, initial.fingerprint, 'removed build inputs must change the snapshot');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('coverage inventory preserves each Node test result marker instead of guessing from its title', () => {
  const statuses = parseNodeTestStatuses([
    '✔ a passing test (2.5ms)',
    '✖ a test with an unfortunate failing title (1s)',
    '﹣ a skipped test (0.1ms)',
    '  ✔ nested suite > passing child (0.4ms)',
    '    ﹣ nested suite > skipped child (0.1ms) # SKIP optional reason',
  ].join('\n'));
  assert.deepEqual(statuses, [
    { title: 'a passing test', status: 'passed' },
    { title: 'a test with an unfortunate failing title', status: 'failed' },
    { title: 'a skipped test', status: 'skipped' },
    { title: 'nested suite > passing child', status: 'passed' },
    { title: 'nested suite > skipped child', status: 'skipped' },
  ]);
});

test('coverage inventory retains only the final Playwright retry per test with a string title', () => {
  assert.deepEqual(deduplicatePlaywrightAttempts([
    { suite: 'playwright', file: 'tests/e2e/example.spec.ts', title: ['', 'group', 'retries once'], status: 'failed', retry: 0, applicationScripts: 0 },
    { suite: 'playwright', file: 'tests/e2e/example.spec.ts', title: ['', 'group', 'retries once'], status: 'passed', retry: 1, applicationScripts: 4 },
    { suite: 'playwright', file: 'tests/e2e/example.spec.ts', title: ['group', 'skipped'], status: 'skipped', retry: 0, applicationScripts: 0 },
  ]), [
    { suite: 'playwright', file: 'tests/e2e/example.spec.ts', title: 'group › retries once', status: 'passed', retry: 1, applicationScripts: 4 },
    { suite: 'playwright', file: 'tests/e2e/example.spec.ts', title: 'group › skipped', status: 'skipped', retry: 0, applicationScripts: 0 },
  ]);
});

test('coverage rejects Node test phases that ran but did not pass any tests', () => {
  assert.doesNotThrow(() => assertNodeTestPhaseHasPassingTests('source-tests', { passed: 1 }));
  assert.doesNotThrow(() => assertNodeTestPhaseHasPassingTests('browser-tests', { passed: 2 }));
  assert.throws(
    () => assertNodeTestPhaseHasPassingTests('source-tests', { passed: 0, skipped: 8 }),
    /source-tests completed without a passing test/,
  );
  assert.throws(
    () => assertNodeTestPhaseHasPassingTests('browser-tests', undefined),
    /browser-tests completed without a passing test/,
  );
  assert.doesNotThrow(() => assertNodeTestPhaseHasPassingTests('playwright', undefined));
});

test('report-only source-map rebuild rejects a nonzero build result with its log path', () => {
  assert.doesNotThrow(() => assertCoverageBuildSucceeded(0, 'coverage.log'));
  assert.throws(
    () => assertCoverageBuildSucceeded(17, '.tmp/coverage-aggregate/run/logs/coverage-source-maps.log'),
    /exited with code 17.*coverage-source-maps\.log/,
  );
});

test('Sonar LCOV must be nonempty and point only to existing original source files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-lcov-'));
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'tests'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'board.ts'), 'export const board = 1;');
    await fs.writeFile(path.join(root, 'tests', 'board.test.ts'), 'test();');
    await fs.writeFile(path.join(root, 'dist', 'board.js'), '');
    const lcov = `TN:\nSF:${path.join(root, 'src', 'board.ts')}\nDA:1,1\nend_of_record\n`;
    assert.deepEqual(await validateLcovSourcePaths(lcov, root), [path.join(root, 'src', 'board.ts')]);
    await assert.rejects(validateLcovSourcePaths('', root), /LCOV is empty/);
    await assert.rejects(validateLcovSourcePaths('SF:tests/board.test.ts\n', root), /non-source or external/);
    await assert.rejects(validateLcovSourcePaths('SF:dist/board.js\n', root), /non-source or external/);
    await assert.rejects(validateLcovSourcePaths('SF:src/missing.ts\n', root), /missing source file/);
    await assert.rejects(validateLcovSourcePaths('SF:../outside.ts\n', root), /non-source or external/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Electron coverage requires a saved host renderer profile and rejects profiler errors', () => {
  assert.deepEqual(electronCoverageCollectionErrors([]), [
    'Electron coverage status is missing; no instrumented host renderer was reported.',
  ]);
  assert.deepEqual(electronCoverageCollectionErrors([
    { testName: 'fixture', status: 'collected', hostRenderersStarted: 1, rendererProfilesSaved: 1, errors: [] },
    { testName: 'closed app', status: 'expected-shutdown' },
  ]), []);
  assert.match(electronCoverageCollectionErrors([
    { testName: 'fixture', status: 'collected', hostRenderersStarted: 0, rendererProfilesSaved: 0, errors: ['Profiler.start failed'] },
  ]).join(' '), /no host renderer profiler started.*no host renderer profile was saved.*Profiler.start failed/);
});

test('coverage suite status distinguishes passed, failed, unknown and skipped metadata', () => {
  assert.equal(coverageSuiteStatus({ exitCode: 0 }), 'passed');
  assert.equal(coverageSuiteStatus({ exitCode: 2 }), 'failed');
  assert.equal(coverageSuiteStatus({}), 'unknown');
  assert.equal(coverageSuiteStatus({ exitCode: null }), 'unknown');
  assert.equal(coverageSuiteStatus({ exitCode: null, skipReason: 'build did not run' }), 'skipped');
  assert.equal(coverageSuiteStatus({ exitCode: 2, skipReason: 'suite was skipped' }), 'failed');
  assert.equal(coverageSuiteStatus({ exitCode: 0, skipReason: 'stale skip note' }), 'passed');
  assert.throws(
    () => assertCoverageSuitesKnown([{ name: 'browser-tests', status: 'unknown' }]),
    /unknown suite status: browser-tests/,
  );
  assert.doesNotThrow(() => assertCoverageSuitesKnown([
    { name: 'source-tests', status: 'passed' },
    { name: 'electron', status: 'failed' },
    { name: 'build', status: 'skipped' },
  ]));
});

test('coverage phase inventory requires all six phases once and accepts explicit runtime skips', () => {
  const phases=REQUIRED_COVERAGE_PHASES.map(name=>({name,exitCode:0}));
  phases.find(phase=>phase.name==='build').exitCode=1;
  for(const phase of phases.filter(item=>['playwright','electron'].includes(item.name))){
    phase.exitCode=null;
    phase.skipped='Production build failed; runtime coverage would refer to stale output.';
  }
  assert.doesNotThrow(()=>assertCoveragePhaseInventory(phases));
  assert.throws(
    ()=>assertCoveragePhaseInventory(phases.filter(phase=>phase.name!=='electron')),
    /missing: electron/,
  );
  assert.throws(
    ()=>assertCoveragePhaseInventory([...phases,{name:'build',exitCode:1}]),
    /duplicate: build/,
  );
  assert.throws(
    ()=>assertCoveragePhaseInventory([...phases,{name:'coverage-report',exitCode:0}]),
    /extra: coverage-report/,
  );
  const successfulBuildWithSkip=phases.map(phase=>({...phase}));
  successfulBuildWithSkip.find(phase=>phase.name==='build').exitCode=0;
  assert.throws(
    ()=>assertCoveragePhaseInventory(successfulBuildWithSkip),
    /requires an explicit nonzero build exit code/,
  );
  const nonRuntimeSkip=REQUIRED_COVERAGE_PHASES.map(name=>({name,exitCode:0}));
  nonRuntimeSkip.find(phase=>phase.name==='typecheck').exitCode=null;
  nonRuntimeSkip.find(phase=>phase.name==='typecheck').skipped='unexpected skip';
  assert.throws(
    ()=>assertCoveragePhaseInventory(nonRuntimeSkip),
    /Only Playwright and Electron phases may be skipped \(found typecheck\)/,
  );
  const contradictorySkip=phases.map(phase=>({...phase}));
  contradictorySkip.find(phase=>phase.name==='playwright').exitCode=1;
  assert.throws(
    ()=>assertCoveragePhaseInventory(contradictorySkip),
    /must have a null exit code/,
  );
});
