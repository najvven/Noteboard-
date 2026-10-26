import { test as base, expect, type Page } from '@playwright/test';
import { clearFixtureBoards } from './fixture-storage';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type E2EFixtures = {fixtureStoreIsolation: undefined; fixtureCoverageCapture: undefined};
type CoverageEntries = Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>;
type CoverageState = {started: Promise<void>; stop?: Promise<void>; entries: CoverageEntries};

export const test = base.extend<E2EFixtures>({
  fixtureStoreIsolation: [async ({request}, use) => {
    await clearFixtureBoards(request);
    await use(undefined);
  }, {auto: true}],
  fixtureCoverageCapture: [async ({context}, use, testInfo) => {
    const outputDirectory = process.env.NOTEBOARD_BROWSER_COVERAGE;
    if (!outputDirectory) { await use(undefined); return; }

    const tracked = new Map<Page, CoverageState>();
    let collectionError: string | undefined;
    const start = (target: Page) => {
      if (tracked.has(target)) return;
      const state: CoverageState = {
        started: target.coverage.startJSCoverage({ resetOnNavigation: false }),
        entries: [],
      };
      state.started.catch(() => undefined);
      tracked.set(target, state);
      const capture = () => state.stop ??= state.started.then(async () => {
        state.entries = await target.coverage.stopJSCoverage();
      });
      const close = target.close.bind(target);
      target.close = async (...args: Parameters<typeof target.close>) => {
        try { await capture(); }
        catch (error) { collectionError = error instanceof Error ? error.message : String(error); }
        return close(...args);
      };
    };
    for (const target of context.pages()) start(target);
    const onPage = (target: Page) => start(target);
    context.on('page', onPage);
    await Promise.all([...tracked.values()].map(state => state.started));
    let scriptCount = 0;
    let appScriptCount = 0;
    try {
      await use(undefined);
    } finally {
      context.off('page', onPage);
      const result = [];
      for (const [target, state] of tracked) {
        try {
          if (!state.stop) {
            if (target.isClosed()) continue;
            state.stop = state.started.then(async () => { state.entries = await target.coverage.stopJSCoverage(); });
          }
          await state.stop;
          result.push(...state.entries);
        } catch (error) {
          collectionError = error instanceof Error ? error.message : String(error);
        }
      }
      const v8Scripts = [];
      const expectedOrigin = process.env.NOTEBOARD_COVERAGE_ORIGIN || 'http://127.0.0.1:3100';
      const distDirectory = path.resolve(process.cwd(), 'dist');
      for (const entry of result) {
        scriptCount++;
        if (!entry.url || !entry.source) continue;
        let scriptUrl: URL;
        try { scriptUrl = new URL(entry.url); } catch { continue; }
        if (scriptUrl.origin !== new URL(expectedOrigin).origin || !scriptUrl.pathname.endsWith('.js')) continue;
        const localPath = path.resolve(distDirectory, `.${decodeURIComponent(scriptUrl.pathname)}`);
        if (localPath !== distDirectory && !localPath.startsWith(`${distDirectory}${path.sep}`)) continue;
        v8Scripts.push({ scriptId: entry.scriptId, url: pathToFileURL(localPath).href, functions: entry.functions });
        appScriptCount++;
      }
      await mkdir(outputDirectory, { recursive: true });
      if (v8Scripts.length) {
        await writeFile(path.join(outputDirectory, `playwright-${randomUUID()}.json`), JSON.stringify({ result: v8Scripts, timestamp: Date.now() }));
      }
      const inventory = {
        suite: 'playwright',
        file: path.relative(process.cwd(), testInfo.file).replaceAll(path.sep, '/'),
        title: testInfo.titlePath.filter(Boolean).join(' › '),
        status: testInfo.status,
        expectedStatus: testInfo.expectedStatus,
        retry: testInfo.retry,
        browserPages: tracked.size,
        scripts: scriptCount,
        applicationScripts: appScriptCount,
        ...(collectionError ? { collectionError } : {}),
      };
      const indexFile = process.env.NOTEBOARD_BROWSER_COVERAGE_INDEX || path.join(outputDirectory, 'playwright-inventory.jsonl');
      await mkdir(path.dirname(indexFile), { recursive: true });
      await appendFile(indexFile, `${JSON.stringify(inventory)}\n`, 'utf8');
    }
  }, {auto: true}],
});

export { expect };
export type * from '@playwright/test';
