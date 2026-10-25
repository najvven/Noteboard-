import type { APIRequestContext } from '@playwright/test';

async function fixtureRevision(request: APIRequestContext, url: string) {
  const response=await request.get('/api/pages');
  if(!response.ok())throw new Error('Could not read fixture board revisions.');
  const id=decodeURIComponent(url.slice('/api/pages/'.length));
  const board=(await response.json()).find((page:{id:string})=>page.id===id);
  return board ? {'If-Match':`"${board.updatedAt??0}"`} : {'If-None-Match':'*'};
}

/** Test setup/cleanup explicitly acknowledges the fixture revision it reads.
 * Protocol-negative tests use raw HTTP, never these setup helpers. */
export async function deleteFixtureBoard(request: APIRequestContext,url:string) {
  return request.delete(url,{headers:await fixtureRevision(request,url)});
}

/** Remove retry leftovers before/after each E2E test, using observed revisions. */
export async function clearFixtureBoards(request: APIRequestContext) {
  const response = await request.get('/api/pages');
  if (!response.ok()) throw new Error('Could not read boards for E2E fixture cleanup.');
  const boards = await response.json() as Array<{id:string;updatedAt?:number}>;
  for (const board of boards) {
    const url = '/api/pages/' + encodeURIComponent(board.id);
    let result = await request.delete(url, {
      headers: {'If-Match': '"' + (board.updatedAt ?? 0) + '"'},
    });
    if (result.status() === 404) continue;
    if (result.status() === 409) {
      result = await request.delete(url, {headers: await fixtureRevision(request, url)});
    }
    if (!result.ok() && result.status() !== 404)
      throw new Error('Could not clean E2E board ' + board.id + ' (' + result.status() + ').');
  }
}

export async function putFixtureBoard(request: APIRequestContext,url:string,options:NonNullable<Parameters<APIRequestContext['put']>[1]>) {
  const headers=options.headers??{};
  if(Object.keys(headers).some(name=>['if-match','if-none-match'].includes(name.toLowerCase())))return request.put(url,options);
  return request.put(url,{...options,headers:{...await fixtureRevision(request,url),...headers}});
}
