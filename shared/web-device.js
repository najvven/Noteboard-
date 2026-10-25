export const WEB_DEVICE_PROFILES = {
  desktop: { label: 'Desktop', defaultSize: { width: 560, height: 360 }, touch: false, deviceScaleFactor: 0 },
  tablet: { label: 'Tablet', defaultSize: { width: 768, height: 1024 }, touch: true, deviceScaleFactor: 2 },
  phone: { label: 'Phone', defaultSize: { width: 390, height: 700 }, touch: true, deviceScaleFactor: 3 },
};

export const normalizeWebDeviceMode = mode => Object.hasOwn(WEB_DEVICE_PROFILES, mode) ? mode : 'desktop';

/** The viewport is measured in board CSS pixels, independently of app/board zoom. */
export function normalizeWebViewport(value = {}) {
  if (!['width', 'height'].every(key => Number.isFinite(value[key]) && value[key] > 0 && value[key] <= 32768)) {
    throw new Error('Invalid Web viewport dimensions.');
  }
  return { mode: normalizeWebDeviceMode(value.deviceMode), width: Math.max(1, Math.round(value.width)), height: Math.max(1, Math.round(value.height)) };
}

export function webDeviceIdentity(mode, chromeVersion, platform = 'win32') {
  const mobile = mode !== 'desktop';
  const phone = mode === 'phone';
  const major = chromeVersion.split('.')[0];
  const desktopPlatform = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64';
  return {
    userAgent: `Mozilla/5.0 (${mobile ? `Linux; Android 13; ${phone ? 'Mobile' : 'Tablet'}` : desktopPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}${phone ? ' Mobile' : ''} Safari/537.36`,
    platform: mobile ? 'Linux armv8l' : platform === 'darwin' ? 'MacIntel' : platform === 'linux' ? 'Linux x86_64' : 'Win32',
    userAgentMetadata: {
      brands: [{ brand: 'Chromium', version: major }],
      fullVersionList: [{ brand: 'Chromium', version: chromeVersion }],
      fullVersion: chromeVersion,
      platform: mobile ? 'Android' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : 'Windows',
      platformVersion: mobile ? '13.0.0' : platform === 'win32' ? '10.0.0' : '',
      architecture: mobile ? 'arm' : 'x86', bitness: '64',
      model: mobile ? (phone ? 'Mobile' : 'Tablet') : '',
      mobile: phone,
      formFactors: [mobile ? (phone ? 'Mobile' : 'Tablet') : 'Desktop'],
    },
  };
}
