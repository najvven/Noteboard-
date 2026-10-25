import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { assertSafeZipDirectory, MAX_ZIP_ENTRY_COUNT } from "../shared/zip-preflight.js";

test("ZIP preflight accepts a normal archive and reports its entries", async () => {
  const zip = new JSZip();
  zip.file("board.json", "{}");
  zip.file("assets/image.txt", "asset");
  const buffer = await zip.generateAsync({ type: "uint8array" });
  assert.deepEqual(assertSafeZipDirectory(buffer), { entryCount: 3 });
});

test("ZIP preflight rejects metadata bombs before JSZip parsing", async () => {
  const zip = new JSZip();
  for (let index = 0; index <= MAX_ZIP_ENTRY_COUNT; index += 1) {
    zip.file(`empty-${index}.txt`, "");
  }
  const buffer = await zip.generateAsync({ type: "uint8array" });
  assert.throws(() => assertSafeZipDirectory(buffer), /too many entries/i);
});

test("ZIP preflight rejects malformed central directories", () => {
  assert.throws(
    () => assertSafeZipDirectory(new Uint8Array([1, 2, 3, 4])),
    /directory|archive/i,
  );
});

test('ZIP metadata validation accepts bounded views and rejects unsupported input and split disks',async()=>{
  const zip=new JSZip();zip.file('board.json','{}');
  const bytes=await zip.generateAsync({type:'uint8array'});
  for(const input of [bytes.buffer,new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)])
    assert.deepEqual(assertSafeZipDirectory(input),{entryCount:1});
  assert.throws(()=>assertSafeZipDirectory('{}'),/input is invalid/);
  const split=bytes.slice();new DataView(split.buffer).setUint16(split.length-18,1,true);
  assert.throws(()=>assertSafeZipDirectory(split),/Multi-disk/);
  const oversizedDirectory=bytes.slice();new DataView(oversizedDirectory.buffer).setUint32(oversizedDirectory.length-10,bytes.length,true);
  assert.throws(()=>assertSafeZipDirectory(oversizedDirectory),/bounds/);
  const badEntry=bytes.slice(),view=new DataView(badEntry.buffer);
  view.setUint32(view.getUint32(bytes.length-6,true),0,true);
  assert.throws(()=>assertSafeZipDirectory(badEntry),/entry is invalid/);
  const inconsistent=bytes.slice();new DataView(inconsistent.buffer).setUint16(bytes.length-12,2,true);
  assert.throws(()=>assertSafeZipDirectory(inconsistent),/entry count is inconsistent/);
  assert.throws(()=>assertSafeZipDirectory(bytes,{maxEntries:0}),/too many/);
});

const zip64=()=>{
  const bytes=new Uint8Array(98),view=new DataView(bytes.buffer);
  view.setUint32(0,0x06064b50,true);view.setBigUint64(4,44n,true);
  view.setUint32(56,0x07064b50,true);view.setBigUint64(64,0n,true);
  view.setUint32(76,0x06054b50,true);view.setUint16(86,0xffff,true);
  view.setUint32(88,0xffffffff,true);view.setUint32(92,0xffffffff,true);
  return {bytes,view};
};

test('ZIP64 preflight validates safe integers and the locator before allowing archive parsing',()=>{
  assert.deepEqual(assertSafeZipDirectory(zip64().bytes),{entryCount:0});
  for(const offset of [32,40,48,64]){
    const {bytes,view}=zip64();view.setBigUint64(offset,BigInt(Number.MAX_SAFE_INTEGER)+1n,true);
    assert.throws(()=>assertSafeZipDirectory(bytes),/exceeds supported limits/);
  }
  const missing=zip64();missing.view.setUint32(56,0,true);
  assert.throws(()=>assertSafeZipDirectory(missing.bytes),/locator is missing/);
  const wrongOffset=zip64();wrongOffset.view.setBigUint64(64,97n,true);
  assert.throws(()=>assertSafeZipDirectory(wrongOffset.bytes),/directory is invalid/);
  const wrongSignature=zip64();wrongSignature.view.setUint32(0,0,true);
  assert.throws(()=>assertSafeZipDirectory(wrongSignature.bytes),/directory is invalid/);
});
