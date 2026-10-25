import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import { assertValidBoard, MAX_BOARD_FILE_BYTES, MAX_MEDIA_FILE_BYTES } from './board-data.js';

const mediaTypes = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.bmp':'image/bmp','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4'};
const MAX_CLIPBOARD_MEDIA_BYTES = 128 * 1024 * 1024;

const readBoundedFile = async (handle) => {
  const chunks = [];
  let total = 0;
  // Read one byte beyond the per-file limit so a file replaced or grown after
  // stat cannot cause an unbounded readFile allocation.
  for await (const chunk of handle.createReadStream({start: 0, end: MAX_MEDIA_FILE_BYTES})) {
    total += chunk.length;
    if (total > MAX_MEDIA_FILE_BYTES) throw new Error('Clipboard media file is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};

export async function readNativeClipboard(clipboard) {
  // Read synchronously before any file I/O: this represents the current OS
  // clipboard even if a later copy happens while an Explorer file is loading.
  const text=clipboard.readText(),html=clipboard.readHTML(),image=clipboard.readImage();
  const formats=clipboard.availableFormats();
  // Windows exposes copied Explorer files as text/uri-list even when their
  // native buffer is FileNameW. Testing only the native name missed those files.
  const fileNames=(formats.includes('FileNameW')||formats.includes('text/uri-list'))
    ? clipboard.readBuffer('FileNameW').toString('utf16le').split('\0').filter(Boolean):[];
  if(!fileNames.length&&formats.includes('text/uri-list')){
    const uris=clipboard.read('text/uri-list').split(/\r?\n/).filter(uri=>uri.startsWith('file:'));
    for(const uri of uris)try{fileNames.push(fileURLToPath(uri));}catch{/* Unsupported clipboard URI. */}
  }
  const files=[];
  let totalMediaBytes = 0;
  for (const name of fileNames.slice(0,32)) {
    const type=mediaTypes[path.extname(name).toLowerCase()];
    if (!type) continue;
    try {
      const handle=await fs.open(name,'r');
      let bytes;
      try {
      const stat=await handle.stat();
      if (!stat.isFile() || stat.size>MAX_MEDIA_FILE_BYTES) throw new Error('Clipboard media file is too large.');
        if (totalMediaBytes + stat.size > MAX_CLIPBOARD_MEDIA_BYTES) throw new Error('Clipboard media exceeds the total size limit.');
        bytes=await readBoundedFile(handle);
        if (totalMediaBytes + bytes.length > MAX_CLIPBOARD_MEDIA_BYTES) throw new Error('Clipboard media exceeds the total size limit.');
      } finally {
        await handle.close();
      }
      files.push({name:path.basename(name),type,base64:bytes.toString('base64')});
      totalMediaBytes += bytes.length;
    } catch {
      // One stale, inaccessible, oversized, or otherwise unreadable file must
      // not discard clipboard text, HTML, images, or files that can be read.
    }
  }
  return {text,html,image:image.isEmpty()?'':image.toDataURL(),files};
}

export function writeNativeBoardClipboard(clipboard,json) {
  if(typeof json!=='string'||Buffer.byteLength(json)>MAX_BOARD_FILE_BYTES)throw new Error('Invalid board clipboard.');
  const value=JSON.parse(json);
  if(value.format!=='noteboard/clipboard'||value.version!==1||!Array.isArray(value.elements)||!Array.isArray(value.sectionSheets))throw new Error('Invalid board clipboard.');
  assertValidBoard({id:'clipboard',title:'Clipboard',elements:value.elements,sectionSheets:value.sectionSheets});
  clipboard.write({text:value.elements.map(element=>element.name||element.type).join(', '),html:`<span data-noteboard-clipboard="${encodeURIComponent(json)}">Noteboard objects</span>`});
  return true;
}
