import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import { assertValidBoard, MAX_BOARD_FILE_BYTES, MAX_MEDIA_FILE_BYTES } from './board-data.js';

const mediaTypes = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.bmp':'image/bmp','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4'};

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
  for (const name of fileNames.slice(0,32)) {
    const type=mediaTypes[path.extname(name).toLowerCase()];
    if (!type) continue;
    const handle=await fs.open(name,'r');
    try {
      const stat=await handle.stat();
      if (!stat.isFile() || stat.size>MAX_MEDIA_FILE_BYTES) throw new Error('Clipboard media file is too large.');
      const bytes=await handle.readFile();
      if(bytes.length>MAX_MEDIA_FILE_BYTES)throw new Error('Clipboard media file is too large.');
      files.push({name:path.basename(name),type,base64:bytes.toString('base64')});
    } finally {await handle.close();}
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
