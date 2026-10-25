import fs from 'node:fs/promises';
import path from 'node:path';

export function runtimeProtectedRoots(root, dataDirectory = process.env.NOTEBOARD_DATA_DIR) {
  return [...new Set([path.resolve(dataDirectory || path.join(root,'data')),
    path.resolve(root,'data'),path.resolve(root,'.tmp'),path.resolve(root,'.ai')])];
}

export function runtimeFsDeny(root, dataDirectory) {
  // Keep Vite's default secret-file rules when extending its deny list.
  return ['.env','.env.*','*.{crt,pem}','**/.git/**',
    ...runtimeProtectedRoots(root,dataDirectory).map(directory=>`${directory.replaceAll('\\','/')}/**`)];
}

const comparisonPath = value => process.platform === 'win32' ? value.toLowerCase() : value;
const inside = (file, directory) => file === directory || file.startsWith(directory + path.sep);

/** Guards resolved targets too, so a public symlink cannot expose runtime data. */
export function createRuntimeFileGuard(root, dataDirectory) {
  const roots=runtimeProtectedRoots(root,dataDirectory);
  const lexical=roots.map(comparisonPath);
  const resolved=Promise.all(roots.map(async directory=>{
    try {return comparisonPath(await fs.realpath(directory));} catch{return comparisonPath(directory);}
  }));
  return async url=>{
    let pathname;
    try {pathname=decodeURIComponent(new URL(url,'http://localhost').pathname);}
    catch{return true;}
    const file=path.resolve(pathname.startsWith('/@fs/')?pathname.slice(5):path.join(root,`.${pathname}`));
    if(lexical.some(directory=>inside(comparisonPath(file),directory)))return true;
    try {
      const target=comparisonPath(await fs.realpath(file));
      return (await resolved).some(directory=>inside(target,directory));
    } catch{return false;}
  };
}
