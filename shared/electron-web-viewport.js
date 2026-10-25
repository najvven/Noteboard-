import { normalizeWebViewport, WEB_DEVICE_PROFILES, webDeviceIdentity } from './web-device.js';

const controllers = new WeakMap();

const sameMetrics = (previous, next) => previous?.mode === next.mode &&
  (next.mode === 'desktop' || (previous.width === next.width && previous.height === next.height));

/** Called only for a guest owned by the trusted board window. No page-supplied scripts. */
export async function configureWebViewport(contents, value, chromeVersion, platform) {
  const viewport = normalizeWebViewport(value);
  let controller = controllers.get(contents);
  if (!controller) {
    controller = { requested: null, identity: null, metrics: null, pending: null };
    controllers.set(contents, controller);
  }
  controller.requested = { viewport, chromeVersion, platform };
  if (!controller.pending) {
    // One worker drains the latest requested state. A resize burst does not
    // create a queue of identical CDP/layout operations, and every caller waits
    // until the most recent state has actually been applied.
    controller.pending = Promise.resolve().then(async () => {
      try {
        while (!contents.isDestroyed()) {
          const requested = controller.requested;
          const current = requested.viewport;
          const profile = WEB_DEVICE_PROFILES[current.mode];
          const identityKey = `${current.mode}:${requested.chromeVersion}:${requested.platform}`;
          if (controller.identity !== identityKey || !contents.debugger.isAttached()) {
            const identity = webDeviceIdentity(current.mode, requested.chromeVersion, requested.platform);
            if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
            contents.setUserAgent(identity.userAgent);
            await contents.debugger.sendCommand('Emulation.setUserAgentOverride', identity);
            await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: profile.touch, maxTouchPoints: profile.touch ? 5 : 1 });
            controller.identity = identityKey;
            controller.metrics = null;
          }
          if (contents.isDestroyed()) return false;
          if (requested !== controller.requested) continue;
          if (contents.getZoomFactor() !== 1) contents.setZoomFactor(1);
          if (!sameMetrics(controller.metrics, current)) {
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
            controller.metrics = current;
          }
          if (requested === controller.requested) return true;
        }
        return false;
      } catch (error) {
        // A failed/detached debugger must be fully configured on the next try.
        controller.identity = null;
        controller.metrics = null;
        throw error;
      } finally {
        controller.pending = null;
      }
    });
  }
  return controller.pending;
}
