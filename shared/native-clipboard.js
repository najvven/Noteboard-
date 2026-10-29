import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
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
    if (total > MAX_MEDIA_FILE_BYTES) throw Object.assign(new Error('Clipboard media file is too large.'), { code: 'FILE_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};

const clipboardFileError = (name, code, message) => ({ name: path.basename(name) || 'Clipboard item', code, message });

export async function readNativeClipboard(clipboard, { fileSystem = fs } = {}) {
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
  const fileErrors=[];
  let totalMediaBytes = 0;
  if (fileNames.length > 32) fileErrors.push(clipboardFileError('Clipboard', 'FILE_COUNT_LIMIT', 'Only the first 32 clipboard files can be checked; remaining items were skipped.'));
  for (const name of fileNames.slice(0,32)) {
    const type=mediaTypes[path.extname(name).toLowerCase()];
    if (!type) {
      fileErrors.push(clipboardFileError(name, 'UNSUPPORTED_FILE_TYPE', 'This clipboard file type cannot be pasted as board media.'));
      continue;
    }
    try {
      // Reject special files before opening them. O_NONBLOCK additionally
      // prevents a path swapped to a FIFO after stat from hanging the app.
      const preliminary = await fileSystem.stat(name);
      if (!preliminary.isFile()) throw Object.assign(new Error('Clipboard item is not a regular file.'), { code: 'NOT_A_REGULAR_FILE' });
      if (preliminary.size > MAX_MEDIA_FILE_BYTES) throw Object.assign(new Error('Clipboard media file is too large.'), { code: 'FILE_TOO_LARGE' });
      if (totalMediaBytes + preliminary.size > MAX_CLIPBOARD_MEDIA_BYTES)
        throw Object.assign(new Error('Clipboard media exceeds the total size limit.'), { code: 'TOTAL_SIZE_LIMIT' });
      const handle=await fileSystem.open(name, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      let bytes;
      try {
        const stat=await handle.stat();
        if (!stat.isFile()) throw Object.assign(new Error('Clipboard item is not a regular file.'), { code: 'NOT_A_REGULAR_FILE' });
        if (stat.size>MAX_MEDIA_FILE_BYTES) throw Object.assign(new Error('Clipboard media file is too large.'), { code: 'FILE_TOO_LARGE' });
        if (totalMediaBytes + stat.size > MAX_CLIPBOARD_MEDIA_BYTES)
          throw Object.assign(new Error('Clipboard media exceeds the total size limit.'), { code: 'TOTAL_SIZE_LIMIT' });
        bytes=await readBoundedFile(handle);
        if (totalMediaBytes + bytes.length > MAX_CLIPBOARD_MEDIA_BYTES)
          throw Object.assign(new Error('Clipboard media exceeds the total size limit.'), { code: 'TOTAL_SIZE_LIMIT' });
      } finally {
        await handle.close();
      }
      files.push({name:path.basename(name),type,base64:bytes.toString('base64')});
      totalMediaBytes += bytes.length;
    } catch (error) {
      const code = error?.code === 'ENOENT' ? 'FILE_MISSING' :
        error?.code === 'FILE_TOO_LARGE' ? 'FILE_TOO_LARGE' :
        error?.code === 'TOTAL_SIZE_LIMIT' ? 'TOTAL_SIZE_LIMIT' :
        error?.code === 'NOT_A_REGULAR_FILE' ? 'NOT_A_REGULAR_FILE' : 'FILE_READ_FAILED';
      const message = error?.code === 'ENOENT' ? 'The clipboard file is no longer available.' :
        error?.code === 'FILE_TOO_LARGE' ? 'The clipboard file exceeds the per-file size limit.' :
        error?.code === 'TOTAL_SIZE_LIMIT' ? 'The clipboard files exceed the total size limit.' :
        error?.code === 'NOT_A_REGULAR_FILE' ? 'The clipboard item is not a regular file.' :
        'The clipboard file could not be read.';
      fileErrors.push(clipboardFileError(name, code, message));
    }
  }
  return {text,html,image:image.isEmpty()?'':image.toDataURL(),files,fileErrors};
}

export function writeNativeBoardClipboard(clipboard,json) {
  if(typeof json!=='string'||Buffer.byteLength(json)>MAX_BOARD_FILE_BYTES)throw new Error('Invalid board clipboard.');
  const value=JSON.parse(json);
  if(value.format!=='noteboard/clipboard'||value.version!==1||!Array.isArray(value.elements)||!Array.isArray(value.sectionSheets))throw new Error('Invalid board clipboard.');
  assertValidBoard({id:'clipboard',title:'Clipboard',elements:value.elements,sectionSheets:value.sectionSheets});
  clipboard.write({text:value.elements.map(element=>element.name||element.type).join(', '),html:`<span data-noteboard-clipboard="${encodeURIComponent(json)}">Noteboard objects</span>`});
  return true;
}
