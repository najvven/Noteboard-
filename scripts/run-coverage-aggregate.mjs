import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  assertCoverageSuitesKnown,
  assertCoverageBuildSucceeded,
  assertCoveragePhaseInventory,
  collectCoverageSourceInventory,
  coverageSuiteStatus,
  electronCoverageCollectionErrors,
  deduplicatePlaywrightAttempts,
  hashCoverageToolFiles,
  parseNodeTestStatuses,
  assertNodeTestPhaseHasPassingTests,
  validateLcovSourcePaths,
  validateReportOnlySnapshot,
} from './coverage-aggregate-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, '.tmp', 'coverage-aggregate');
const require = createRequire(import.meta.url);
const C8Report = require('c8').Report;
const { createCoverageMap } = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const istanbulReports = require('istanbul-reports');
const v8ToIstanbul = require('v8-to-istanbul');
const { mergeProcessCovs } = require('@bcoe/v8-coverage');
const reportOptions = {
  all: true,
  src: [root],
  include: [
    'main.js', 'preload.cjs', 'web-privacy-preload.cjs', 'server.ts',
    'src/**/*.ts', 'src/**/*.tsx',
    'shared/**/*.js', 'shared/**/*.cjs', 'shared/**/*.mjs',
    'scripts/web-adblock-extension/**/*.js', 'scripts/web-adblock-extension/**/*.mjs',
  ],
  exclude: [
    '**/tests/**', '**/*.test.*', '**/*.spec.*', '**/__tests__/**',
    '**/node_modules/**', '**/dist/**', '**/build/**', '**/release/**',
    '**/.tmp/**', '**/.ai/**', '**/graphify-out/**', '**/data/**',
    '**/coverage/**', '**/playwright-report/**', '**/test-results/**',
  ],
  excludeAfterRemap: true,
  extension: ['.js', '.cjs', '.mjs', '.ts', '.tsx'],
  reporter: ['text-summary', 'json', 'json-summary', 'html', 'lcov'],
  omitRelative: true,
  resolve: root,
  excludeNodeModules: true,
  mergeAsync: true,
  skipFull: false,
};

const slash = value => value.replaceAll(path.sep, '/');
const runId = () => new Date().toISOString().replaceAll(/[-:.]/g, '') + `-${randomUUID().slice(0, 8)}`;

async function collectSourceInventory() {
  const { fingerprint, files } = await collectCoverageSourceInventory(root);
  const coverageToolSha256 = await hashCoverageToolFiles(root);
  return { fingerprint, coverageToolSha256, files };
}

async function streamCommand(label, executable, args, env, logFile) {
  const output = await fs.open(logFile, 'w');
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const forward = async (stream, destination) => {
    for await (const chunk of stream) {
      await output.write(chunk);
      destination.write(chunk);
    }
  };
  const forwarded = Promise.all([forward(child.stdout, process.stdout), forward(child.stderr, process.stderr)]);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', result => resolve(result ?? 1));
  }).finally(() => output.close());
  await forwarded;
  return Number(code);
}

async function listTestFiles(directory, pattern = /\.(?:test|spec)\.(?:mjs|tsx?)$/) {
  const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && pattern.test(entry.name))
    .map(entry => slash(path.join(directory, entry.name))).sort();
}

async function buildCoverage(runDirectory, sourceInventory) {
  const nodeReporter = new C8Report({
    ...reportOptions,
    reporter: [],
    reportsDirectory: path.join(runDirectory, 'report'),
    tempDirectory: path.join(runDirectory, 'node-v8'),
  });
  await fs.mkdir(path.join(runDirectory, 'report'), { recursive: true });
  const coverageMap = createCoverageMap(await nodeReporter.getCoverageMapFromAllCoverageFiles());
  const profileErrors = [];
  const browserProfiles = [];
  let electronProfileFiles = 0;
  for (const directoryName of ['browser-v8', 'electron-v8']) {
    const directory = path.join(runDirectory, directoryName);
    const profileFiles = await fs.readdir(directory).catch(() => []);
    for (const profileFile of profileFiles.filter(name => name.endsWith('.json'))) {
      const profile = JSON.parse(await fs.readFile(path.join(directory, profileFile), 'utf8'));
      if (Array.isArray(profile.result)) {
        browserProfiles.push(profile);
        if (directoryName === 'electron-v8' && profile.result.length) electronProfileFiles++;
      }
    }
  }
  const mergedProfiles = browserProfiles.length ? mergeProcessCovs(browserProfiles) : { result: [] };
  for (const script of mergedProfiles.result) {
    let scriptPath;
    try {
      if (script.url.startsWith('file:')) scriptPath = fileURLToPath(new URL(script.url));
      else if (path.isAbsolute(script.url)) scriptPath = script.url;
      else continue;
    } catch { continue; }
    const relativePath = path.relative(root, scriptPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
    try {
      const converter = v8ToIstanbul(scriptPath);
      await converter.load();
      converter.applyCoverage(script.functions || []);
      const mapped = converter.toIstanbul();
      for (const [sourcePath, fileCoverage] of Object.entries(mapped)) {
        if (nodeReporter.exclude.shouldInstrument(path.resolve(sourcePath)))
          coverageMap.merge({ [path.resolve(sourcePath)]: fileCoverage });
      }
    } catch (error) {
      profileErrors.push({ script: scriptPath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const context = libReport.createContext({
    dir: path.join(runDirectory, 'report'),
    coverageMap,
    watermarks: libReport.getDefaultWatermarks(),
    defaultSummarizer: 'flat',
  });
  for (const reporterName of reportOptions.reporter)
    istanbulReports.create(reporterName, { skipEmpty: false, skipFull: false, maxCols: 120 }).execute(context);
  const summary = JSON.parse(await fs.readFile(path.join(runDirectory, 'report', 'coverage-summary.json'), 'utf8'));
  const totals = summary.total;
  const metrics = {
    lines: Number(totals.lines.pct),
    branches: Number(totals.branches.pct),
    functions: Number(totals.functions.pct),
    statements: Number(totals.statements.pct),
  };
  const phases = JSON.parse(await fs.readFile(path.join(runDirectory, 'suite-results.json'), 'utf8'));
  assertCoveragePhaseInventory(phases);
  const electronCoverageStatus = await fs.readFile(path.join(runDirectory, 'electron-coverage-status.json'), 'utf8')
    .then(text => JSON.parse(text)).catch(() => []);
  const electronCoverageErrors = electronCoverageCollectionErrors(electronCoverageStatus);
  if (electronProfileFiles === 0 && !electronCoverageErrors.includes('Electron produced no host renderer coverage profile.'))
    electronCoverageErrors.push('Electron produced no host renderer coverage profile file.');
  const rows = Object.entries(summary).filter(([key]) => key !== 'total');
  const inventory = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: path.basename(runDirectory),
    sourceFingerprint: sourceInventory.fingerprint,
    coverageToolSha256: sourceInventory.coverageToolSha256,
    sourceFiles: sourceInventory.files,
    codeFilesMeasured: rows.length,
    metrics,
    thresholdPercent: 80,
    testSuites: [],
    electronCoverage: {
      rendererProfiles: electronProfileFiles,
      instrumentedTestRuns: electronCoverageStatus.filter(item => item?.status === 'collected').length,
      expectedShutdowns: electronCoverageStatus.filter(item => item?.status === 'expected-shutdown').length,
      collectionErrors: electronCoverageErrors,
    },
    sourceMapProfilesConverted: mergedProfiles.result.length,
    sourceMapProfileErrors: profileErrors,
    metricNotes: [
      'Percentages are weighted totals from merged V8 execution profiles, not averages of suite percentages.',
      'Node profiles are remapped by c8. Chromium and Electron window profiles use local Vite assets and their source maps.',
      'Only application-owned source files in the c8 include list contribute; test code, dependencies and generated dist files do not.',
      'Chromium extension service-worker files are included, but these runs do not attach a profiler to that worker; they remain uncovered unless a worker profile is available.',
    ],
  };
  const playwrightTests = deduplicatePlaywrightAttempts(
    JSON.parse(await fs.readFile(path.join(runDirectory, 'playwright-tests.json'), 'utf8')),
  );
  const playwrightCaptureFailures = playwrightTests.filter(item => item.collectionError);
  for (const phase of phases) {
    const skipReason = phase.skipped || undefined;
    const status = coverageSuiteStatus({ exitCode: phase.exitCode, skipReason });
    if (status === 'skipped') {
      inventory.testSuites.push({ name: phase.name, files: phase.files || [], passed: null, skipped: 0, failed: 0, exitCode: phase.exitCode ?? null, skipReason, status, tests: [] });
      continue;
    }
    const log = phase.log
      ? (await fs.readFile(path.join(runDirectory, phase.log), 'utf8').catch(() => '')).replaceAll(/\u001b\[[0-9;]*m/g, '')
      : '';
    const counts = log.match(/ℹ tests (\d+)\s*\r?\nℹ suites (\d+)\s*\r?\nℹ pass (\d+)\s*\r?\nℹ fail (\d+)\s*\r?\nℹ cancelled (\d+)\s*\r?\nℹ skipped (\d+)/);
    if (status === 'passed') {
      assertNodeTestPhaseHasPassingTests(phase.name, counts ? {
        total: Number(counts[1]),
        passed: Number(counts[3]),
        failed: Number(counts[4]),
        skipped: Number(counts[6]),
      } : undefined);
    }
    const testStatuses = parseNodeTestStatuses(log);
    const browserCases = phase.name === 'playwright' ? playwrightTests : [];
    const browserPassed = browserCases.filter(item => item.status === 'passed').length;
    const browserFailed = browserCases.filter(item => item.status === 'failed').length;
    const browserSkipped = browserCases.filter(item => item.status === 'skipped').length;
    inventory.testSuites.push({
      name: phase.name,
      files: phase.files || [],
      passed: counts ? Number(counts[3]) : phase.name === 'playwright' ? browserPassed : null,
      skipped: counts ? Number(counts[6]) : phase.name === 'playwright' ? browserSkipped : 0,
      failed: counts ? Number(counts[4]) : phase.name === 'playwright' ? browserFailed : 0,
      exitCode: phase.exitCode,
      status,
      ...(skipReason ? { skipReason } : {}),
      tests: phase.name === 'playwright'
        ? browserCases.map(item => ({ title: item.title, file: item.file, status: item.status, applicationScripts: item.applicationScripts }))
        : testStatuses,
    });
  }
  inventory.playwrightCoverage = {
    testsWithApplicationCode: playwrightTests.filter(item => item.applicationScripts > 0).length,
    testsWithoutApplicationCode: playwrightTests.filter(item => item.applicationScripts === 0).length,
    applicationScriptsCaptured: playwrightTests.reduce((total, item) => total + item.applicationScripts, 0),
    collectionFailures: playwrightCaptureFailures.length,
  };
  inventory.failedSuites = inventory.testSuites.filter(suite => suite.status !== 'skipped' && (suite.failed > 0 || (suite.exitCode !== undefined && suite.exitCode !== null && suite.exitCode !== 0)))
    .map(suite => ({ name: suite.name, exitCode: suite.exitCode ?? null, failedTests: suite.failed }));
  await fs.writeFile(path.join(runDirectory, 'coverage-inventory.json'), JSON.stringify(inventory, null, 2));
  await fs.mkdir(path.join(root, 'coverage'), { recursive: true });
  const reportLcovPath = path.join(runDirectory, 'report', 'lcov.info');
  const lcov = await fs.readFile(reportLcovPath, 'utf8');
  await validateLcovSourcePaths(lcov, root);
  const stableLcovPath = path.join(root, 'coverage', 'lcov.info');
  const pendingLcovPath = `${stableLcovPath}.${path.basename(runDirectory)}.tmp`;
  try {
    await fs.copyFile(reportLcovPath, pendingLcovPath);
    await fs.rename(pendingLcovPath, stableLcovPath);
  } finally {
    await fs.rm(pendingLcovPath, { force: true });
  }
  const markdown = [
    '# Combined code coverage and executed tests', '',
    `Run: ${inventory.runId}`,
    `Source snapshot SHA-256: ${inventory.sourceFingerprint}`, '',
    'Coverage is computed from merged V8 profiles and mapped to application source files. Files that were not loaded remain in the totals.', '',
    '| Metric | Coverage | Threshold |', '| --- | ---: | ---: |',
    ...Object.entries(metrics).map(([name, value]) => `| ${name} | ${value}% | 80% |`), '',
    `Application files measured: ${rows.length}`, '', '## Test suites', '',
  ];
  markdown.push('## Electron renderer coverage', '',
    `Renderer profiles: ${inventory.electronCoverage.rendererProfiles}`,
    `Instrumented test runs: ${inventory.electronCoverage.instrumentedTestRuns}`,
    `Expected shutdowns before profile collection: ${inventory.electronCoverage.expectedShutdowns}`,
    ...(inventory.electronCoverage.collectionErrors.length ? inventory.electronCoverage.collectionErrors.map(error => `- ${error}`) : ['Collection errors: none']), '',
  );
  for (const suite of inventory.testSuites) {
    if (suite.passed === null) { markdown.push('### ' + suite.name + ' validation: ' + suite.status, ''); continue; }
    markdown.push(`### ${suite.name}: ${suite.status} — ${suite.passed} passed, ${suite.skipped} skipped, ${suite.failed} failed`, '');
    if (suite.files.length) markdown.push('Test files:', ...suite.files.map(file => `- \`${file}\``), '');
    if (suite.tests.length) markdown.push('Executed tests:', ...suite.tests.map(item => `- ${item.status === 'passed' ? '✓' : item.status === 'skipped' ? '–' : '✗'} ${item.title}`), '');
  }
  markdown.push('## Reports and reruns', '', '- report/index.html contains source-mapped per-file detail.', '- report/coverage-final.json is the machine-readable combined result.', '- coverage-inventory.json lists the exact source snapshot and executed tests.', '- Raw profiles are saved by runtime; npm run test:coverage:report regenerates totals without rerunning the test suites.', '');
  await fs.writeFile(path.join(runDirectory, 'README.md'), markdown.join('\n'));
  if (profileErrors.length) throw new Error('Could not map ' + profileErrors.length + ' Chromium/Electron scripts to source. See ' + path.relative(root, runDirectory) + '.');
  if (inventory.electronCoverage.collectionErrors.length)
    throw new Error('Electron renderer coverage collection failed: ' + inventory.electronCoverage.collectionErrors.join(' ') + ` See ${path.relative(root, runDirectory)}.`);
  const failed = Object.entries(metrics).filter(([, pct]) => pct < 80);
  if (playwrightCaptureFailures.length) throw new Error(`Chromium coverage collection failed for ${playwrightCaptureFailures.length} tests. See ${path.relative(root, runDirectory)}.`);
  if (!inventory.playwrightCoverage.applicationScriptsCaptured) throw new Error(`Chromium produced no application-script profiles. See ${path.relative(root, runDirectory)}.`);
  if (failed.length) throw new Error(`Aggregate coverage remains below 80%: ${failed.map(([key, pct]) => `${key} ${pct}%`).join(', ')}. Reports were written to ${path.relative(root, runDirectory)}.`);
  if (inventory.failedSuites.length) throw new Error('Coverage was aggregated, but test failures remain in ' + inventory.failedSuites.map(suite => suite.name).join(', ') + '. See ' + path.relative(root, runDirectory) + '.');
  assertCoverageSuitesKnown(inventory.testSuites);
  return inventory;
}

async function main() {
  const reportOnly = process.argv.includes('--report-only');
  const runDirectory = reportOnly
    ? path.join(outputRoot, (await fs.readFile(path.join(outputRoot, 'latest.json'), 'utf8')).trim())
    : path.join(outputRoot, runId());
  if (reportOnly) {
    const previous = JSON.parse(await fs.readFile(path.join(runDirectory, 'source-files.json'), 'utf8'));
    const current = await collectSourceInventory();
    validateReportOnlySnapshot(previous, current);
    let missingSourceMap = false;
    for (const directoryName of ['browser-v8', 'electron-v8']) {
      const directory = path.join(runDirectory, directoryName);
      for (const name of await fs.readdir(directory).catch(() => [])) {
        if (!name.endsWith('.json')) continue;
        const profile = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
        for (const script of profile.result || []) {
          if (!script.url?.startsWith('file:')) continue;
          const scriptPath = fileURLToPath(new URL(script.url));
          if (scriptPath.startsWith(path.join(root, 'dist', 'assets') + path.sep) &&
              !(await fs.stat(scriptPath + '.map').then(() => true).catch(() => false))) missingSourceMap = true;
        }
      }
    }
    if (missingSourceMap) {
      const npmCli = process.env.npm_execpath;
      if (!npmCli) throw new Error('Cannot recreate the matching source maps outside npm.');
      await fs.mkdir(path.join(runDirectory, 'logs'), { recursive: true });
      const logPath = path.join(runDirectory, 'logs', 'coverage-source-maps.log');
      const exitCode = await streamCommand('coverage-source-maps', process.execPath, [npmCli, 'run', 'build'],
        { ...process.env, NOTEBOARD_COVERAGE: '1' }, logPath);
      assertCoverageBuildSucceeded(exitCode, path.relative(root, logPath));
    }
  }
  if (!reportOnly) {
    await fs.mkdir(path.join(runDirectory, 'logs'), { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'node-v8'), { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'browser-v8'), { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'electron-v8'), { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'browser-index'), { recursive: true });
    const sourceInventory = await collectSourceInventory();
    await fs.writeFile(path.join(runDirectory, 'source-files.json'), JSON.stringify(sourceInventory, null, 2));
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Run this command through npm so the local npm CLI can be resolved.');
    const env = {
      ...process.env,
      NODE_V8_COVERAGE: path.join(runDirectory, 'node-v8'),
      NOTEBOARD_COVERAGE: '1',
      NOTEBOARD_COVERAGE_RUN: path.basename(runDirectory),
      NOTEBOARD_BROWSER_COVERAGE: path.join(runDirectory, 'browser-v8'),
      NOTEBOARD_BROWSER_COVERAGE_INDEX: path.join(runDirectory, 'browser-index', 'playwright.jsonl'),
      NOTEBOARD_ELECTRON_COVERAGE: path.join(runDirectory, 'electron-v8'),
      NOTEBOARD_ELECTRON_COVERAGE_STATUS: path.join(runDirectory, 'electron-coverage-status.jsonl'),
      NOTEBOARD_COVERAGE_ORIGIN: 'http://127.0.0.1:3100',
    };
    const phases = [
      { name: 'typecheck', executable: process.execPath, args: [npmCli, 'run', 'typecheck'] },
      { name: 'source-tests', executable: process.execPath, args: [npmCli, 'test'] },
      { name: 'browser-tests', executable: process.execPath, args: [npmCli, 'run', 'test:browser'] },
      { name: 'build', executable: process.execPath, args: [npmCli, 'run', 'build'] },
      { name: 'playwright', executable: process.execPath, args: [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'] },
    ];
    const electronFiles = await listTestFiles('tests/electron', /^.+\.test\.mjs$/);
    phases.push({ name: 'electron', executable: process.execPath, args: ['--test', '--test-concurrency=1', ...electronFiles.map(file => path.join(root, file))] });
    const phaseResults = [];
    let buildSucceeded = true;
    for (const phase of phases) {
      const files = phase.name === 'source-tests' ? await listTestFiles('tests')
        : phase.name === 'browser-tests' ? await listTestFiles('tests/browser')
        : phase.name === 'playwright' ? await listTestFiles('tests/e2e')
        : phase.name === 'electron' ? electronFiles : [];
      if (!buildSucceeded && ['playwright', 'electron'].includes(phase.name)) {
        phaseResults.push({ name: phase.name, files, exitCode: null, skipped: 'Production build failed; runtime coverage would refer to stale output.' });
        continue;
      }
      const started = new Date().toISOString();
      const args = phase.name === 'playwright' ? [...phase.args, '--reporter=list'] : phase.args;
      const log = 'logs/' + phase.name + '.log';
      let exitCode = 1, error;
      try { exitCode = await streamCommand(phase.name, phase.executable, args, env, path.join(runDirectory, log)); }
      catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
      phaseResults.push({ name: phase.name, startedAt: started, log, files, exitCode, ...(error ? { error } : {}) });
      if (phase.name === 'build' && exitCode !== 0) buildSucceeded = false;
    }
    await fs.writeFile(path.join(runDirectory, 'suite-results.json'), JSON.stringify(phaseResults, null, 2));
    const electronStatusPath = path.join(runDirectory, 'electron-coverage-status.jsonl');
    const electronStatuses = await fs.readFile(electronStatusPath, 'utf8')
      .then(text => text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))).catch(() => []);
    await fs.writeFile(path.join(runDirectory, 'electron-coverage-status.json'), JSON.stringify(electronStatuses, null, 2));
    const playwrightIndex = path.join(runDirectory, 'browser-index', 'playwright.jsonl');
    const playwrightTests = await fs.readFile(playwrightIndex, 'utf8').then(text => text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))).catch(() => []);
    await fs.writeFile(path.join(runDirectory, 'playwright-tests.json'), JSON.stringify(playwrightTests, null, 2));
    await fs.writeFile(path.join(outputRoot, 'latest.json'), path.basename(runDirectory));
  }
  const sourceInventory = JSON.parse(await fs.readFile(path.join(runDirectory, 'source-files.json'), 'utf8'));
  const inventory = await buildCoverage(runDirectory, sourceInventory);
  if (reportOnly) process.stdout.write(`Coverage report regenerated from saved V8 profiles: ${path.relative(root, runDirectory)}\n`);
  else process.stdout.write(`Coverage artifacts and test inventory saved: ${path.relative(root, runDirectory)}\n`);
  if (inventory) process.stdout.write(`Combined coverage: lines ${inventory.metrics.lines}%, branches ${inventory.metrics.branches}%, functions ${inventory.metrics.functions}%.\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
