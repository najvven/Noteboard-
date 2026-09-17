import { getDomain } from 'tldts';

// Helpers inside filter scriptlets must not collide with website globals or
// with another scriptlet's lexical declarations (e.g. YouTube's JSONPath/_).
export const isolateScriptlet = script => {
  // Ghostery 2.18.2 already inserts literal arguments, but its generated call
  // URI-decodes them again. Preserve percent-bearing patterns verbatim; only
  // remove the decoder in that generated trailing argument list.
  const code = script.replace(/\.map\(\(a\) => decodeURIComponent\(a\)\)(\)\s*)$/, '$1');
  return `(function(){\n${code}\n})();`;
};

/** Guest-only IPC. Page-provided URLs never determine where filters are injected. */
export function installAdCosmeticHandlers(ipcMain, getSettings, getEngine) {
  const supported = event => {
    if (event.sender.isDestroyed() || !event.senderFrame || event.senderFrame.isDestroyed()) return false;
    const settings = getSettings(event.sender);
    return settings?.adBlock && event.senderFrame === event.sender.mainFrame && /^https?:\/\//i.test(event.senderFrame.url);
  };
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', event => Boolean(supported(event)));
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, _untrustedUrl, message) => {
    if (!supported(event)) return;
    const frame = event.senderFrame;
    const url = frame.url;
    const hostname = new URL(url).hostname;
    const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length < 4096).slice(0, 10000) : undefined;
    const first = message === undefined;
    const engine = await getEngine();
    if (frame.isDestroyed() || frame.url !== url || !supported(event)) return;
    const { active, styles, scripts } = engine.getCosmeticsFilters({
      url, hostname, domain: getDomain(hostname, { allowPrivateDomains: true }) || hostname,
      ids: list(message?.ids), classes: list(message?.classes), hrefs: list(message?.hrefs),
      getBaseRules: first, getInjectionRules: first, getExtendedRules: false, getRulesFromHostname: first, getRulesFromDOM: !first,
    });
    if (!active) return;
    if (styles) await event.sender.insertCSS(styles, { cssOrigin: 'user' });
    for (const script of scripts) {
      if (frame.isDestroyed() || frame.url !== url) break;
      await frame.executeJavaScript(isolateScriptlet(script)).catch(error => console.warn('Ad scriptlet could not be applied.', String(error)));
    }
  });
}
