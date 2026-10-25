import { test as base, expect } from '@playwright/test';
import { clearFixtureBoards } from './fixture-storage';

type E2EFixtures = {fixtureStoreIsolation: undefined};

export const test = base.extend<E2EFixtures>({
  fixtureStoreIsolation: [async ({request}, use) => {
    await clearFixtureBoards(request);
    await use(undefined);
  }, {auto: true}],
});

export { expect };
export type * from '@playwright/test';
