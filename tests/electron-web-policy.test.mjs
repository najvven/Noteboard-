import assert from "node:assert/strict";
import test from "node:test";

import {
  createIsolatedPopupOptions,
  createWebRequestHeaderHandlers,
  filterRequestHeaders,
  filterResponseHeaders,
  normalizeWebSessionSettings,
  shouldBlockCookies,
  shouldBlockPopup,
} from "../shared/electron-web-policy.js";

function headerHarness(settings) {
  const counts = { policyLookups: 0, filterServiceAcquisitions: 0, blockedCookies: 0, cspApplications: 0, errors: [] };
  const handlers = createWebRequestHeaderHandlers({
    getSettings: () => settings ? normalizeWebSessionSettings(settings) : undefined,
    resolvePolicy: (_details, current) => {
      counts.policyLookups += 1;
      return { settings: current };
    },
    getFilterService: async () => {
      counts.filterServiceAcquisitions += 1;
      return { engine: {} };
    },
    addFilterCsp: (_engine, _details, headers) => {
      counts.cspApplications += 1;
      return { ...headers, "Content-Security-Policy": ["default-src 'none'"] };
    },
    countBlocked: kind => { if (kind === "cookies") counts.blockedCookies += 1; },
    onError: error => counts.errors.push(error),
  });
  return { handlers, counts };
}

const runHeaderListener = (listener, details) => new Promise(resolve => listener(details, resolve));

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

test("disabled cookie and non-frame CSP paths skip policy lookup and filter-engine acquisition", async () => {
  const requestOff = headerHarness();
  const requestResult = await runHeaderListener(requestOff.handlers.onBeforeSendHeaders, {
    url: "https://example.com/api", requestHeaders: { Cookie: "session=1", Accept: "*/*" },
  });
  assert.deepEqual(requestResult, {});
  assert.equal(requestOff.counts.policyLookups, 0);

  const defaultOff = headerHarness();
  const responseResult = await runHeaderListener(defaultOff.handlers.onHeadersReceived, {
    resourceType: "image", url: "https://example.com/image.png", responseHeaders: { "Content-Type": ["image/png"] },
  });
  assert.deepEqual(responseResult, {});
  assert.equal(defaultOff.counts.policyLookups, 0);
  assert.equal(defaultOff.counts.filterServiceAcquisitions, 0);

  const adsOff = headerHarness({ adBlock: false });
  const frameResult = await runHeaderListener(adsOff.handlers.onHeadersReceived, {
    resourceType: "mainFrame", url: "https://example.com", responseHeaders: { "Content-Type": ["text/html"] },
  });
  assert.deepEqual(frameResult, {});
  assert.equal(adsOff.counts.policyLookups, 0);
  assert.equal(adsOff.counts.filterServiceAcquisitions, 0);
});

test("frame responses keep CSP and cookie policy; third-party blocks still filter headers", async () => {
  const defaults = headerHarness();
  const defaultFrame = await runHeaderListener(defaults.handlers.onHeadersReceived, {
    resourceType: "mainFrame", url: "https://example.com", responseHeaders: { "Content-Type": ["text/html"] },
  });
  assert.deepEqual(defaultFrame.responseHeaders, {
    "Content-Type": ["text/html"],
    "Content-Security-Policy": ["default-src 'none'"],
  });
  assert.equal(defaults.counts.policyLookups, 1);
  assert.equal(defaults.counts.filterServiceAcquisitions, 1);
  assert.equal(defaults.counts.cspApplications, 1);

  const thirdParty = headerHarness({ cookieBlocker: "third-party", topLevelUrl: "https://example.com", adBlock: false });
  const trackerRequest = await runHeaderListener(thirdParty.handlers.onBeforeSendHeaders, {
    url: "https://tracker.example.net/pixel", requestHeaders: { Cookie: "tracking=1", Accept: "*/*" },
  });
  assert.deepEqual(trackerRequest.requestHeaders, { Accept: "*/*" });
  assert.equal(thirdParty.counts.policyLookups, 1);
  const trackerHeaders = await runHeaderListener(thirdParty.handlers.onHeadersReceived, {
    resourceType: "image", url: "https://tracker.example.net/pixel",
    responseHeaders: { "Set-Cookie": ["tracking=1"], "Content-Type": ["image/gif"] },
  });
  assert.deepEqual(trackerHeaders.responseHeaders, { "Content-Type": ["image/gif"] });
  assert.equal(thirdParty.counts.policyLookups, 2);
  assert.equal(thirdParty.counts.filterServiceAcquisitions, 0);
  assert.equal(thirdParty.counts.blockedCookies, 2);

  const blockedFrame = headerHarness({ cookieBlocker: "third-party", topLevelUrl: "https://example.com" });
  const blockedFrameHeaders = await runHeaderListener(blockedFrame.handlers.onHeadersReceived, {
    resourceType: "subFrame", url: "https://tracker.example.net/frame",
    responseHeaders: { "Set-Cookie": ["tracking=1"], "Content-Type": ["text/html"] },
  });
  assert.deepEqual(blockedFrameHeaders.responseHeaders, {
    "Content-Type": ["text/html"],
    "Content-Security-Policy": ["default-src 'none'"],
  });
  assert.equal(blockedFrame.counts.policyLookups, 1);
  assert.equal(blockedFrame.counts.filterServiceAcquisitions, 1);
  assert.equal(blockedFrame.counts.blockedCookies, 1);
  assert.deepEqual(blockedFrame.counts.errors, []);
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
