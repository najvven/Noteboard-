import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWebDeviceMode, normalizeWebViewport, webDeviceIdentity, WEB_DEVICE_PROFILES } from '../shared/web-device.js';

test('Web viewports reject invalid metrics and keep independently resizable dimensions', () => {
  for (const value of [{}, {width:NaN,height:300}, {width:800,height:0}, {width:Infinity,height:600}, {width:40000,height:600}]) {
    assert.throws(() => normalizeWebViewport(value), /dimensions/);
  }
  assert.deepEqual(normalizeWebViewport({width:823.4,height:347.6,deviceMode:'tablet'}), {width:823,height:348,mode:'tablet'});
  assert.equal(normalizeWebDeviceMode('__proto__'),'desktop');
  assert.equal(normalizeWebDeviceMode(undefined),'desktop');
  assert.ok(WEB_DEVICE_PROFILES.tablet.defaultSize.width > WEB_DEVICE_PROFILES.phone.defaultSize.width);
});

test('Chromium identities agree with device mode and the installed engine version', () => {
  for (const mode of ['desktop','tablet','phone']) {
    const identity = webDeviceIdentity(mode, '146.0.7680.216', 'win32');
    assert.match(identity.userAgent, /Chrome\/146\.0\.7680\.216/);
    assert.doesNotMatch(identity.userAgent, /Version\/17|iPhone|iPad|Electron/);
    assert.equal(identity.userAgentMetadata.mobile,mode === 'phone');
    assert.equal(identity.userAgentMetadata.platform,mode === 'desktop' ? 'Windows' : 'Android');
  }
});
