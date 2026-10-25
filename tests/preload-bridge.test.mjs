import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const preloadSource = fs.readFileSync(path.join(root, "..", "preload.cjs"), "utf8");

test("preload exposes the narrow NoteBoard bridge without Node runtime globals", () => {
  const exposed = new Map();
  const ipcRenderer = {
    invoke: async () => undefined,
    on: () => undefined,
    removeListener: () => undefined,
  };
  const context = {
    process: { versions: { electron: "41.3.0", node: "24.0.0" } },
    require: (moduleName) => {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (name, value) => exposed.set(name, value),
        },
        ipcRenderer,
      };
    },
  };

  vm.runInNewContext(preloadSource, context, { filename: "preload.cjs" });

  assert.equal(exposed.has("process"), false);
  assert.equal(typeof exposed.get("noteboardAPI")?.configureWebSession, "function");
  assert.equal("ipcRenderer" in exposed, false);
  assert.equal("require" in exposed, false);
});
