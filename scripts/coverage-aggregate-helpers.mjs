import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Keep every local module that can change aggregate/report-only behavior here.
export const COVERAGE_TOOL_FILES = [
  'scripts/run-coverage-aggregate.mjs',
  'scripts/coverage-aggregate-helpers.mjs',
];
export const REQUIRED_COVERAGE_PHASES = [
  'typecheck', 'source-tests', 'browser-tests', 'build', 'playwright', 'electron',
];

export async function hashCoverageToolFiles(root) {
  const digest = createHash('sha256');
  for (const relative of COVERAGE_TOOL_FILES) {
    const content = await fs.readFile(path.join(root, ...relative.split('/')));
    digest.update(relative).update('\0').update(content).update('\0');
  }
  return digest.digest('hex');
}

const isSha256 = value => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);

export function validateReportOnlySnapshot(previous, current) {
  if (
    !isSha256(previous?.fingerprint) || !isSha256(current?.fingerprint) ||
    previous.fingerprint !== current.fingerprint
  ) throw new Error('Source or test files have changed since this coverage run. Run test:coverage:all for a matching snapshot.');
  if (
    !isSha256(previous?.coverageToolSha256) || !isSha256(current?.coverageToolSha256) ||
    previous.coverageToolSha256 !== current.coverageToolSha256
  ) throw new Error('The saved coverage-tool hash is missing or coverage tool files have changed. Run test:coverage:all for matching profiles.');
}

export function assertCoveragePhaseInventory(phases) {
  if (!Array.isArray(phases)) throw new Error('Coverage phase inventory must be an array.');
  const counts = new Map();
  for (const phase of phases) {
    if (typeof phase?.name === 'string') counts.set(phase.name, (counts.get(phase.name) ?? 0) + 1);
  }
  const missing = REQUIRED_COVERAGE_PHASES.filter(name => !counts.has(name));
  const duplicates = REQUIRED_COVERAGE_PHASES.filter(name => (counts.get(name) ?? 0) > 1);
  const requiredNames = new Set(REQUIRED_COVERAGE_PHASES);
  const extra = [...new Set(phases
    .map(phase => phase?.name)
    .filter(name => typeof name !== 'string' || !requiredNames.has(name))
    .map(name => typeof name === 'string' ? name : '<missing name>'))];
  if (missing.length || duplicates.length || extra.length) {
    const details = [
      ...(missing.length ? [`missing: ${missing.join(', ')}`] : []),
      ...(duplicates.length ? [`duplicate: ${duplicates.join(', ')}`] : []),
      ...(extra.length ? [`extra: ${extra.join(', ')}`] : []),
    ];
    throw new Error(`Coverage phase inventory must contain each required phase exactly once (${details.join('; ')}).`);
  }
  const build = phases.find(phase => phase.name === 'build');
  const buildFailed = typeof build.exitCode === 'number' && Number.isFinite(build.exitCode) && build.exitCode !== 0;
  for (const phase of phases.filter(item => item.skipped)) {
    if (!['playwright', 'electron'].includes(phase.name))
      throw new Error(`Only Playwright and Electron phases may be skipped (found ${phase.name}).`);
    if (!buildFailed)
      throw new Error(`Skipped runtime phase ${phase.name} requires an explicit nonzero build exit code.`);
    if (phase.exitCode !== null)
      throw new Error(`Skipped runtime phase ${phase.name} must have a null exit code.`);
  }
}

export function coverageSuiteStatus({ exitCode, skipReason } = {}) {
  if (typeof exitCode === 'number' && Number.isFinite(exitCode) && exitCode !== 0)
    return 'failed';
  if (exitCode === 0) return 'passed';
  if (skipReason) return 'skipped';
  return 'unknown';
}

export function assertCoverageSuitesKnown(suites) {
  const unknown = suites.filter(suite => suite.status === 'unknown').map(suite => suite.name || 'unnamed');
  if (unknown.length)
    throw new Error(`Coverage aggregate cannot pass with unknown suite status: ${unknown.join(', ')}.`);
}
