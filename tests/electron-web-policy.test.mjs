import assert from "node:assert/strict";
import test from "node:test";

import {
  createIsolatedPopupOptions,
  filterRequestHeaders,
  filterResponseHeaders,
  normalizeWebSessionSettings,
  shouldBlockCookies,
  shouldBlockPopup,
} from "../shared/electron-web-policy.js";

test("web session settings are normalized to safe, stable defaults", () => {
  assert.deepEqual(normalizeWebSessionSettings(), {
    topLevelUrl: "",
    adBlock: true,
    cookieBlocker: "off",
    popupBlocker: false,
  });

  assert.deepEqual(
    normalizeWebSessionSettings({
      topLevelUrl: "https://example.com/notes",
      adBlock: false,
      cookieBlocker: "all",
      popupBlocker: false,
    }),
    {
      topLevelUrl: "https://example.com/notes",
      adBlock: false,
      cookieBlocker: "all",
      popupBlocker: false,
    },
  );

  assert.equal(
    normalizeWebSessionSettings({
      topLevelUrl: "file:///secret.txt",
      cookieBlocker: "invalid",
    }).topLevelUrl,
    "",
  );
  assert.equal(
    normalizeWebSessionSettings({
      topLevelUrl: "file:///secret.txt",
      cookieBlocker: "invalid",
    }).cookieBlocker,
    "off",
  );
});

test("cookie filtering distinguishes same-site and third-party requests", () => {
  const thirdPartySettings = {
    topLevelUrl: "https://www.example.com/article",
    cookieBlocker: "third-party",
  };

  assert.equal(
    shouldBlockCookies("https://cdn.example.com/app.js", thirdPartySettings),
    false,
  );
  assert.equal(
    shouldBlockCookies("https://tracker.example.net/pixel", thirdPartySettings),
    true,
  );
  assert.equal(
    shouldBlockCookies("https://www.example.com/api", { cookieBlocker: "all" }),
    true,
  );
  assert.equal(
    shouldBlockCookies("https://tracker.example.net/pixel", {
      ...thirdPartySettings,
      cookieBlocker: "off",
    }),
    false,
  );
  // Fail closed when a third-party policy has not received a top-level URL yet.
  assert.equal(shouldBlockCookies("https://tracker.example.net/pixel", {
    cookieBlocker: "third-party",
  }), true);
});

test("cookie header filters are immutable and case-insensitive", () => {
  const requestHeaders = {
    Cookie: "session=secret",
    Cookie2: "legacy=secret",
    Accept: "application/javascript",
  };
  const responseHeaders = {
    "Set-Cookie": ["session=secret; Secure"],
    "Set-Cookie2": ["legacy=secret"],
    "Content-Type": ["text/html"],
  };
  const settings = {
    topLevelUrl: "https://example.com",
    cookieBlocker: "all",
  };

  const filteredRequest = filterRequestHeaders(
    requestHeaders,
    "https://example.com/api",
    settings,
  );
  const filteredResponse = filterResponseHeaders(
    responseHeaders,
    "https://example.com/api",
    settings,
  );

  assert.deepEqual(requestHeaders, {
    Cookie: "session=secret",
    Cookie2: "legacy=secret",
    Accept: "application/javascript",
  });
  assert.deepEqual(responseHeaders, {
    "Set-Cookie": ["session=secret; Secure"],
    "Set-Cookie2": ["legacy=secret"],
    "Content-Type": ["text/html"],
  });
  assert.deepEqual(filteredRequest, { Accept: "application/javascript" });
  assert.deepEqual(filteredResponse, { "Content-Type": ["text/html"] });
});

test("popup policy honors the switch while keeping URL validation active", () => {
  assert.equal(shouldBlockPopup("https://example.com/popup"), false);
  assert.equal(shouldBlockPopup("https://example.com/popup", { popupBlocker: true }), true);
  assert.equal(
    shouldBlockPopup("https://example.com/popup", { popupBlocker: false }),
    false,
  );
  assert.equal(
    shouldBlockPopup("about:blank", { popupBlocker: false }),
    false,
  );
  assert.equal(
    shouldBlockPopup("data:text/html,<script>alert(1)</script>", {
      popupBlocker: false,
    }),
    true,
  );
  assert.equal(
    shouldBlockPopup("https://user:pass@example.com", { popupBlocker: false }),
    true,
  );
});

test("allowed popups retain the isolated source partition and hardened preferences", () => {
  const options = createIsolatedPopupOptions("persist:noteboard-web-example");

  assert.equal(options.autoHideMenuBar, true);
  assert.deepEqual(options.webPreferences, {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: true,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    partition: "persist:noteboard-web-example",
  });
});
