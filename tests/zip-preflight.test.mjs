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
  const inconsistent=bytes.slice(), inconsistentView=new DataView(inconsistent.buffer);
  inconsistentView.setUint16(bytes.length-14,2,true);
  inconsistentView.setUint16(bytes.length-12,2,true);
  assert.throws(()=>assertSafeZipDirectory(inconsistent),/entry count is inconsistent/);
  assert.throws(()=>assertSafeZipDirectory(bytes,{maxEntries:0}),/too many/);
});

const zip64=()=>{
  const bytes=new Uint8Array(98),view=new DataView(bytes.buffer);
  view.setUint32(0,0x06064b50,true);view.setBigUint64(4,44n,true);
  view.setUint32(56,0x07064b50,true);view.setBigUint64(64,0n,true);
  view.setUint32(72,1,true);
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

test('ZIP64 per-disk sentinel cannot hide a larger directory from classic EOCD fields',async()=>{
  const zip=new JSZip();
  for(let index=0;index<=MAX_ZIP_ENTRY_COUNT;index++)zip.file(`entry-${index}.txt`,"");
  const classic=await zip.generateAsync({type:'uint8array'});
  const view=new DataView(classic.buffer,classic.byteOffset,classic.byteLength);
  const eocd=classic.length-22;
  assert.equal(view.getUint32(eocd,true),0x06054b50);
  const centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);
  const firstName=view.getUint16(centralOffset+28,true),firstExtra=view.getUint16(centralOffset+30,true),firstComment=view.getUint16(centralOffset+32,true);
  const firstEntryBytes=46+firstName+firstExtra+firstComment;
  const attacked=new Uint8Array(classic.length+76);
  attacked.set(classic.subarray(0,eocd));
  attacked.set(classic.subarray(eocd),eocd+76);
  const attackedView=new DataView(attacked.buffer),zip64Offset=eocd,locatorOffset=eocd+56,attackedEocd=eocd+76;
  attackedView.setUint32(zip64Offset,0x06064b50,true);
  attackedView.setBigUint64(zip64Offset+4,44n,true);
  attackedView.setUint16(zip64Offset+12,45,true);attackedView.setUint16(zip64Offset+14,45,true);
  attackedView.setBigUint64(zip64Offset+24,BigInt(MAX_ZIP_ENTRY_COUNT+1),true);
  attackedView.setBigUint64(zip64Offset+32,BigInt(MAX_ZIP_ENTRY_COUNT+1),true);
  attackedView.setBigUint64(zip64Offset+40,BigInt(centralSize),true);
  attackedView.setBigUint64(zip64Offset+48,BigInt(centralOffset),true);
  attackedView.setUint32(locatorOffset,0x07064b50,true);attackedView.setBigUint64(locatorOffset+8,BigInt(zip64Offset),true);attackedView.setUint32(locatorOffset+16,1,true);
  attackedView.setUint16(attackedEocd+8,0xffff,true);
  attackedView.setUint16(attackedEocd+10,1,true);
  attackedView.setUint32(attackedEocd+12,firstEntryBytes,true);
  const parsed=await JSZip.loadAsync(attacked);
  assert.equal(Object.values(parsed.files).length,MAX_ZIP_ENTRY_COUNT+1);
  assert.throws(()=>assertSafeZipDirectory(attacked),/too many entries|inconsistent/i);
});
