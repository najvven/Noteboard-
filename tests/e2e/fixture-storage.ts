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
export async function putFixtureBoard(request: APIRequestContext,url:string,options:NonNullable<Parameters<APIRequestContext['put']>[1]>) {
  const headers=options.headers??{};
  if(Object.keys(headers).some(name=>['if-match','if-none-match'].includes(name.toLowerCase())))return request.put(url,options);
  return request.put(url,{...options,headers:{...await fixtureRevision(request,url),...headers}});
}
