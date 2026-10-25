import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { readNativeClipboard, writeNativeBoardClipboard } from "../shared/native-clipboard.js";
import { MAX_MEDIA_FILE_BYTES } from '../shared/board-data.js';

test("native clipboard keeps text, HTML, image, and readable files when another file is missing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "noteboard-clipboard-"));
  try {
    const imagePath = path.join(directory, "valid.png");
    await writeFile(imagePath, Buffer.from([1, 2, 3, 4]));
    const missingPath = path.join(directory, "missing.png");
    const uris = [missingPath, imagePath].map((name) => pathToFileURL(name).href).join("\r\n");
    const clipboard = {
      readText: () => "clipboard text",
      readHTML: () => "<b>clipboard html</b>",
      readImage: () => ({ isEmpty: () => false, toDataURL: () => "data:image/png;base64,AQID" }),
      availableFormats: () => ["text/uri-list"],
      readBuffer: () => Buffer.alloc(0),
      read: () => uris,
    };

    const result = await readNativeClipboard(clipboard);
    assert.equal(result.text, "clipboard text");
    assert.equal(result.html, "<b>clipboard html</b>");
    assert.equal(result.image, "data:image/png;base64,AQID");
    assert.deepEqual(result.files, [
      { name: "valid.png", type: "image/png", base64: "AQIDBA==" },
    ]);
    assert.deepEqual(result.fileErrors.map(({ name, code }) => ({ name, code })), [
      { name: 'missing.png', code: 'FILE_MISSING' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Explorer filenames skip oversized and unsupported files while keeping later readable media',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'noteboard-clipboard-limit-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const huge=path.join(directory,'huge.png'),good=path.join(directory,'good.png');
  const handle=await open(huge,'wx');try{await handle.truncate(MAX_MEDIA_FILE_BYTES+1);}finally{await handle.close();}
  await writeFile(good,Buffer.from([9,8,7]));
  const result=await readNativeClipboard({
    readText:()=>'',readHTML:()=>'',readImage:()=>({isEmpty:()=>true}),
    availableFormats:()=>['FileNameW'],
    readBuffer:()=>Buffer.from([huge,path.join(directory,'unknown.bin'),good,''].join('\0'),'utf16le'),
  });
  assert.equal(result.image,'');
  assert.deepEqual(result.files,[{name:'good.png',type:'image/png',base64:'CQgH'}]);
  assert.deepEqual(result.fileErrors.map(({ name, code }) => ({ name, code })), [
    { name: 'huge.png', code: 'FILE_TOO_LARGE' },
    { name: 'unknown.bin', code: 'UNSUPPORTED_FILE_TYPE' },
  ]);
});

test('clipboard checks the file type before opening an OS clipboard path', async () => {
  let opened = false;
  const clipboard = {
    readText: () => 'keep this text', readHTML: () => '',
    readImage: () => ({ isEmpty: () => true }),
    availableFormats: () => ['FileNameW'],
    readBuffer: () => Buffer.from('special.png\0', 'utf16le'),
  };
  const fileSystem = {
    stat: async () => ({ isFile: () => false, size: 0 }),
    open: async () => { opened = true; throw Error('A non-file should not be opened.'); },
  };
  const result = await readNativeClipboard(clipboard, { fileSystem });
  assert.equal(opened, false);
  assert.equal(result.text, 'keep this text');
  assert.equal(result.files.length, 0);
  assert.deepEqual(result.fileErrors.map(({ code }) => code), ['NOT_A_REGULAR_FILE']);
});

test('native editable-object copy validates the document and safely encodes its HTML payload',()=>{
  const writes=[],clipboard={write:value=>writes.push(value)};
  const payload={format:'noteboard/clipboard',version:1,sectionSheets:[],elements:[
    {id:'shape',type:'rectangle',name:'Żółć " <b>',position:{x:1,y:2},size:{width:30,height:40},content:'',zIndex:1},
  ]};
  const json=JSON.stringify(payload);
  assert.equal(writeNativeBoardClipboard(clipboard,json),true);
  assert.equal(writes[0].text,payload.elements[0].name);
  assert.equal(decodeURIComponent(writes[0].html.match(/data-noteboard-clipboard="([^"]+)"/)[1]),json);
  for(const invalid of [undefined,'invalid JSON',JSON.stringify({...payload,version:2}),JSON.stringify({...payload,sectionSheets:null}),JSON.stringify({...payload,elements:[{...payload.elements[0],parentId:'missing'}]})])
    assert.throws(()=>writeNativeBoardClipboard(clipboard,invalid));
  assert.equal(writes.length,1);
});
