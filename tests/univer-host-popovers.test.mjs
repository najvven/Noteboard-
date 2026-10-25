import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { patchUniverHostPopovers,univerHostPopovers,univerHostPopoversPrebundle } from "../scripts/univer-host-popovers.mjs";
test("pinned Univer popovers use the configured document without changing the installed module", async () => {
  const path = "node_modules/@univerjs/design/lib/es/index.js",
    original = fs.readFileSync(path, "utf8"),
    patched = patchUniverHostPopovers(original);
  assert.equal(
    patched.split(
      "container: useContext(ConfigContext).mountContainer ?? undefined,",
    ).length - 1,
    3,
  );
  assert.equal(fs.readFileSync(path, "utf8"), original);
  const transform=univerHostPopovers().transform;
  assert.equal(transform(original,'C:/app/node_modules/@univerjs/design/lib/es/index.js?v=dev').code,patched);
  const absolute=process.cwd().replaceAll('\\','/')+'/'+path;
  let load;
  univerHostPopoversPrebundle().setup({onLoad({filter},callback){assert.ok(filter.test(absolute));load=callback;}});
  const prepared=await load({path:absolute});
  assert.equal(prepared.contents,patched);assert.equal(prepared.loader,'js');
  assert.throws(
    () => patchUniverHostPopovers("function OtherModule(){}"),
    /Unsupported Univer/,
  );
});
