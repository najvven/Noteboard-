import { normalizeWebViewport, WEB_DEVICE_PROFILES, webDeviceIdentity } from './web-device.js';

const controllers = new WeakMap();

/** Called only for a guest owned by the trusted board window. No page-supplied scripts. */
export async function configureWebViewport(contents, value, chromeVersion, platform) {
  const viewport = normalizeWebViewport(value);
  let controller = controllers.get(contents);
  if (!controller) {
    controller = { viewport, mode: null, pending: Promise.resolve() };
    controllers.set(contents, controller);
  }
  controller.viewport = viewport;
  controller.pending = controller.pending.catch(() => undefined).then(async () => {
    if (contents.isDestroyed()) return false;
    const current = controller.viewport;
    const profile = WEB_DEVICE_PROFILES[current.mode];
    if (controller.mode !== current.mode || !contents.debugger.isAttached()) {
      const identity = webDeviceIdentity(current.mode, chromeVersion, platform);
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
      contents.setUserAgent(identity.userAgent);
      await contents.debugger.sendCommand('Emulation.setUserAgentOverride', identity);
      await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: profile.touch, maxTouchPoints: profile.touch ? 5 : 1 });
      controller.mode = current.mode;
    }
    if (contents.isDestroyed()) return false;
    if (contents.getZoomFactor() !== 1) contents.setZoomFactor(1);
    if (current.mode === 'desktop') {
      await contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    } else {
      const portrait = current.height >= current.width;
      await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: current.width, height: current.height,
        screenWidth: current.width, screenHeight: current.height,
        mobile: true, deviceScaleFactor: profile.deviceScaleFactor,
        screenOrientation: { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: portrait ? 0 : 90 },
      });
    }
    return true;
  });
  return controller.pending;
}
