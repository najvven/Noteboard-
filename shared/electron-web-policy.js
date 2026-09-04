import { isAllowedEmbeddedWebUrl } from "./electron-security.js";
import { isThirdPartySite } from "./site-boundary.js";

const AD_BLOCK_HOST_PATTERNS = Object.freeze([
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google",
  "amazon-adsystem.com",
  "adsystem.com",
  "adnxs.com",
  "adsrvr.org",
  "advertising.com",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "scorecardresearch.com",
  "quantserve.com",
  "zedo.com",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "moatads.com",
  "mathtag.com",
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "hotjar.com",
  "clarity.ms",
  "segment.io",
  "mixpanel.com",
  "amplitude.com",
  "facebook.net",
  "connect.facebook.net",
]);

const AD_BLOCK_URL_PATTERNS = Object.freeze([
  "/ads/",
  "/adserver",
  "/adservice",
  "/advert",
  "/banner",
  "/sponsor",
  "/tracking",
  "/track?",
  "/pixel",
  "/beacon",
  "doubleclick",
  "googlesyndication",
  "googleadservices",
  "utm_source=ad",
  "adunit=",
  "adslot=",
  "ad_type=",
]);

const COOKIE_BLOCKER_MODES = new Set(["off", "third-party", "all"]);

const getHostname = (value) => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
};

const hostnameMatches = (hostname, pattern) => {
  const normalizedPattern = pattern.toLowerCase().replace(/\.$/, "");
  return hostname === normalizedPattern || hostname.endsWith(`.${normalizedPattern}`);
};

export const shouldBlockByAdList = (value) => {
  const url = String(value || "").trim().toLowerCase();
  const hostname = getHostname(url);
  return (
    AD_BLOCK_HOST_PATTERNS.some((pattern) => hostnameMatches(hostname, pattern)) ||
    AD_BLOCK_URL_PATTERNS.some((pattern) => url.includes(pattern))
  );
};

export const normalizeWebSessionSettings = (settings = {}) => ({
  topLevelUrl:
    typeof settings.topLevelUrl === "string" &&
    isAllowedEmbeddedWebUrl(settings.topLevelUrl)
      ? settings.topLevelUrl
      : "",
  adBlock: settings.adBlock !== false,
  cookieBlocker: COOKIE_BLOCKER_MODES.has(settings.cookieBlocker)
    ? settings.cookieBlocker
    : "off",
  popupBlocker: settings.popupBlocker !== false,
});

export const shouldBlockCookies = (requestUrl, settings = {}) => {
  const normalized = normalizeWebSessionSettings(settings);
  if (normalized.cookieBlocker === "all") return true;
  if (normalized.cookieBlocker !== "third-party") return false;

  // Unknown top-level context is treated as third-party so a missing or stale
  // navigation event cannot accidentally leak cookies.
  if (!normalized.topLevelUrl) return true;
  return isThirdPartySite(requestUrl, normalized.topLevelUrl);
};

const withoutHeaders = (headers, headerNames) => {
  const filtered = { ...(headers || {}) };
  const targets = new Set(headerNames.map((headerName) => headerName.toLowerCase()));
  for (const key of Object.keys(filtered)) {
    if (targets.has(key.toLowerCase())) delete filtered[key];
  }
  return filtered;
};

export const filterRequestHeaders = (headers, requestUrl, settings = {}) =>
  shouldBlockCookies(requestUrl, settings)
    ? withoutHeaders(headers, ["cookie", "cookie2"])
    : { ...(headers || {}) };

export const filterResponseHeaders = (headers, requestUrl, settings = {}) =>
  shouldBlockCookies(requestUrl, settings)
    ? withoutHeaders(headers, ["set-cookie", "set-cookie2"])
    : { ...(headers || {}) };

export const shouldBlockWebRequest = (url, settings = {}) => {
  const normalized = normalizeWebSessionSettings(settings);
  return normalized.adBlock && shouldBlockByAdList(url);
};

export const shouldBlockPopup = (url, settings = {}) => {
  const normalized = normalizeWebSessionSettings(settings);
  return normalized.popupBlocker || !isAllowedEmbeddedWebUrl(url);
};

export const createIsolatedPopupOptions = (partition) => ({
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    ...(partition ? { partition } : {}),
  },
});
