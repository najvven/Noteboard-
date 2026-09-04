import assert from "node:assert/strict";
import test from "node:test";

import { installPermissionDenyHandlers } from "../shared/electron-permissions.js";

test("Electron sessions deny permission checks and requests by default", () => {
  let checkHandler;
  let requestHandler;
  const webSession = {
    setPermissionCheckHandler(handler) {
      checkHandler = handler;
    },
    setPermissionRequestHandler(handler) {
      requestHandler = handler;
    },
  };

  assert.equal(installPermissionDenyHandlers(webSession), true);
  assert.equal(checkHandler?.({}, "media", "https://example.com"), false);
  let decision = true;
  requestHandler?.({}, "media", (allowed) => {
    decision = allowed;
  });
  assert.equal(decision, false);
  assert.equal(installPermissionDenyHandlers(webSession), false);
});
