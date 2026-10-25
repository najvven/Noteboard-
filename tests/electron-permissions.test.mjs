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
  installPermissionDenyHandlers(webSession,{allowFullscreen:true});
  assert.equal(checkHandler?.({},'fullscreen','https://www.youtube.com'),true);
  assert.equal(checkHandler?.({},'media','https://www.youtube.com'),false);
  requestHandler?.({},'fullscreen',allowed=>{decision=allowed});assert.equal(decision,true);
  for(const permission of ['geolocation','notifications','clipboard-read','display-capture','pointerLock']) assert.equal(checkHandler?.({},permission,'https://www.youtube.com'),false);
});
