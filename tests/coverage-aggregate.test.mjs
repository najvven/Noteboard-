import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COVERAGE_TOOL_FILES,
  assertCoverageSuitesKnown,
  assertCoveragePhaseInventory,
  coverageSuiteStatus,
  hashCoverageToolFiles,
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
