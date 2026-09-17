import { isAllowedEmbeddedWebUrl } from "./electron-security.js";
import { isThirdPartySite } from "./site-boundary.js";

const COOKIE_BLOCKER_MODES = new Set(["off", "third-party", "all"]);

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
  popupBlocker: settings.popupBlocker === true,
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

export const shouldBlockPopup = (url, settings = {}) => {
  const normalized = normalizeWebSessionSettings(settings);
  return normalized.popupBlocker || !isAllowedEmbeddedWebUrl(url);
};

export const createIsolatedPopupOptions = (partition) => ({
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: true,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    ...(partition ? { partition } : {}),
  },
});
