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

const REQUIRED_COVERAGE_INPUTS = [
  'index.html', 'sheet.html', 'src/index.css', 'main.js', 'preload.cjs',
  'web-privacy-preload.cjs', 'server.ts', 'package.json', 'package-lock.json',
  'playwright.config.ts', 'vite.config.ts', 'tsconfig.json', 'sonar-project.properties',
];
const COVERAGE_SOURCE_DIRECTORIES = [
  'src', 'shared', 'scripts', 'tests',
];
const COVERAGE_INPUT_EXTENSION = /\.(?:[cm]?[jt]sx?|css|html)$/i;

const toPosix = value => value.replaceAll(path.sep, '/');

/** Build a deterministic snapshot of source, test, page, style, and build inputs. */
export async function collectCoverageSourceInventory(root) {
  const files = new Set(REQUIRED_COVERAGE_INPUTS);
  const visit = async relativeDirectory => {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && COVERAGE_INPUT_EXTENSION.test(entry.name)) files.add(toPosix(relative));
    }
  };

  for (const input of REQUIRED_COVERAGE_INPUTS) {
    const stat = await fs.stat(path.join(root, ...input.split('/')));
    if (!stat.isFile()) throw new Error(`Required coverage input is not a file: ${input}`);
  }
  for (const directory of COVERAGE_SOURCE_DIRECTORIES) await visit(directory);

  const entries = [];
  const digest = createHash('sha256');
  for (const relative of [...files].sort()) {
    const content = await fs.readFile(path.join(root, ...relative.split('/')));
    entries.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex') });
    digest.update(relative).update('\0').update(content).update('\0');
  }
  return { fingerprint: digest.digest('hex'), files: entries };
}

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

export function deduplicatePlaywrightAttempts(attempts) {
  if (!Array.isArray(attempts)) throw new Error('Playwright test attempts must be an array.');
  const latestAttempts = new Map();
  for (const attempt of attempts) {
    const title = Array.isArray(attempt?.title)
      ? attempt.title.filter(Boolean).join(' › ')
      : String(attempt?.title ?? '');
    const file = String(attempt?.file ?? '');
    const retry = Number.isInteger(attempt?.retry) && attempt.retry >= 0 ? attempt.retry : 0;
    const key = JSON.stringify([file, title]);
    const previous = latestAttempts.get(key);
    if (!previous || retry >= previous.retry)
      latestAttempts.set(key, { ...attempt, file, title, retry });
  }
  return [...latestAttempts.values()];
}

export function parseNodeTestStatuses(log) {
  return [...log.matchAll(/^[ \t]*([✔✖﹣])[ \t]+(.+?)[ \t]+\((\d+(?:\.\d+)?)(ms|s)\)(?:[ \t]+#\s*SKIP(?:[ \t]+.*)?)?[ \t]*$/gm)]
    .map(match => ({
      title: match[2],
      status: match[1] === '✔' ? 'passed' : match[1] === '✖' ? 'failed' : 'skipped',
    }));
}

export function assertNodeTestPhaseHasPassingTests(phaseName, summary) {
  if (!['source-tests', 'browser-tests'].includes(phaseName)) return;
  if (!summary || !Number.isInteger(summary.passed) || summary.passed < 1)
    throw new Error(`Node test phase ${phaseName} completed without a passing test.`);
}

export function assertCoverageBuildSucceeded(exitCode, logPath) {
  if (exitCode !== 0)
    throw new Error(`Could not recreate coverage source maps: npm run build exited with code ${exitCode}. See ${logPath}.`);
}

export async function validateLcovSourcePaths(lcov, root) {
  const sources = [...lcov.matchAll(/^SF:(.+)$/gm)].map(match => match[1].trim());
  if (sources.length === 0) throw new Error('Combined LCOV is empty and contains no source files.');
  for (const source of sources) {
    const absolute = path.resolve(root, source);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) ||
        /(^|[\\/])(tests|node_modules|dist|release|\.tmp)([\\/]|$)/i.test(relative))
      throw new Error(`Combined LCOV references a non-source or external file: ${source}`);
    if (!(await fs.stat(absolute).then(stat => stat.isFile()).catch(() => false)))
      throw new Error(`Combined LCOV references a missing source file: ${source}`);
  }
  return sources;
}

export function electronCoverageCollectionErrors(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0)
    return ['Electron coverage status is missing; no instrumented host renderer was reported.'];
  const errors = [];
  for (const [index, status] of statuses.entries()) {
    if (status?.status === 'expected-shutdown') continue;
    if (status?.status !== 'collected') {
      errors.push(`Electron test ${status?.testName || index + 1}: renderer coverage status is ${status?.status || 'unknown'}.`);
      continue;
    }
    if (!Number.isInteger(status.hostRenderersStarted) || status.hostRenderersStarted < 1)
      errors.push(`Electron test ${status.testName || index + 1}: no host renderer profiler started.`);
    if (!Number.isInteger(status.rendererProfilesSaved) || status.rendererProfilesSaved < 1)
      errors.push(`Electron test ${status.testName || index + 1}: no host renderer profile was saved.`);
    if (Array.isArray(status.errors) && status.errors.length)
      errors.push(`Electron test ${status.testName || index + 1}: ${status.errors.join('; ')}`);
  }
  if (!statuses.some(status => status?.status === 'collected' && status.rendererProfilesSaved > 0))
    errors.push('Electron produced no host renderer coverage profile.');
  return errors;
}

export function assertCoverageSuitesKnown(suites) {
  const unknown = suites.filter(suite => suite.status === 'unknown').map(suite => suite.name || 'unnamed');
  if (unknown.length)
    throw new Error(`Coverage aggregate cannot pass with unknown suite status: ${unknown.join(', ')}.`);
}
