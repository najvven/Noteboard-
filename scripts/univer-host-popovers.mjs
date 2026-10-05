/** Univer 1.0.2's Radix popovers ignore ConfigProvider.mountContainer. Honor it
 * so a live ribbon portaled into the host uses the host's document and styles.
 * The build transform is pinned, reproducible, and never edits node_modules. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export function patchUniverHostPopovers(source) {
  for (const [name, portal] of [
    ["PopoverContent", "Portal$1"],
    ["DropdownMenuContent", "Portal"],
    ["DropdownMenuPortal", "Portal"],
  ]) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0)
      throw Error(`Unsupported Univer design source: ${name} is missing.`);
    const point = source.indexOf(`jsx(${portal}, {`, start);
    if (point < 0 || source.slice(start, point).includes("\nfunction "))
      throw Error(`Unsupported Univer design portal: ${name}.`);
    const insert = point + `jsx(${portal}, {`.length;
    source =
      source.slice(0, insert) +
      " container: useContext(ConfigContext).mountContainer ?? undefined," +
      source.slice(insert);
  }
  return source;
}

/** @returns {import('esbuild').Plugin} */
export function univerHostPopoversPrebundle() {
  return {name:'univer-host-popovers-prebundle',setup(build){
    build.onLoad({filter:/[\\/]@univerjs[\\/]design[\\/]lib[\\/]es[\\/]index\.js$/},async({path:file})=>({
      contents:patchUniverHostPopovers(await readFile(file,'utf8')),loader:'js',resolveDir:path.dirname(file),
    }));
  }};
}

/** @returns {import('vite').Plugin} */
export function univerHostPopovers() {
  return {
    name: "univer-host-popovers",
    enforce: "pre",
    transform(source, id) {
      if (
        !id.split('?')[0].replaceAll("\\", "/").endsWith("/@univerjs/design/lib/es/index.js")
      )
        return;
      return { code: patchUniverHostPopovers(source), map: null };
    },
  };
}
