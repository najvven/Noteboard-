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
  const stylesByFrame = new WeakMap();
  const supported = event => {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    if (!sender || sender.isDestroyed() || sender.getType?.() !== 'webview' ||
        !frame || frame.isDestroyed() || frame.top !== sender.mainFrame ||
        !/^https?:\/\//i.test(frame.url)) return false;
    return getSettings(sender)?.adBlock === true;
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
    if (styles && !frame.isDestroyed() && frame.url === url && supported(event)) {
      let state = stylesByFrame.get(frame);
      if (!state || state.url !== url) state = { url, styles: new Set() };
      const existingStyleCount = state.styles.size;
      state.styles.add(styles);
      stylesByFrame.set(frame, state);
      if (state.styles.size !== existingStyleCount) {
        const styleId = 'noteboard-adblocker-cosmetics';
        const code = `(() => { let style = document.getElementById(${JSON.stringify(styleId)}); if (!style) { style = document.createElement('style'); style.id = ${JSON.stringify(styleId)}; (document.head || document.documentElement).appendChild(style); } style.appendChild(document.createTextNode(${JSON.stringify(styles)})); })()`;
        await frame.executeJavaScript(code).catch(error => {
          console.warn('Ad cosmetic styles could not be applied.', String(error));
        });
      }
    }
    for (const script of scripts) {
      if (frame.isDestroyed() || frame.url !== url || !supported(event)) break;
      await frame.executeJavaScript(isolateScriptlet(script)).catch(error => console.warn('Ad scriptlet could not be applied.', String(error)));
    }
  });
}
