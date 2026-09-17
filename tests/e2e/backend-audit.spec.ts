import { test, expect } from '@playwright/test';

test('invalid bulk imports cannot partially replace an existing board', async ({request}) => {
  const original = {id:'bulk-audit',title:'Original',width:800,height:600,elements:[],updatedAt:1};
  expect((await request.post('/api/pages',{data:[original]})).ok()).toBe(true);
  const response=await request.post('/api/pages',{data:[{...original,title:'Should not be saved'},{...original,id:'../invalid'}]});
  expect(response.status()).toBe(400);
  const pages=await (await request.get('/api/pages')).json();
  expect(pages.find((page:any)=>page.id===original.id).title).toBe('Original');
  await request.delete('/api/pages/bulk-audit');
});
