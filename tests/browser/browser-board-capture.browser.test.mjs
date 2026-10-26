import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const helperPath = new URL('../../src/features/board/browser-region-capture.ts', import.meta.url);

const bundleCaptureHelper = () => build({
    entryPoints: [fileURLToPath(helperPath)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'BrowserBoardCapture',
    platform: 'browser',
    target: 'es2020',
  });

test('browser board capture crops visible DOM pixels and suppresses grid and selection overlays', async () => {
  const bundled = await bundleCaptureHelper();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>
        html,body{margin:0;width:180px;height:140px}
        [data-board-root]{position:absolute;left:0;top:0;width:100px;height:80px;overflow:visible}
        [data-board-surface]{position:absolute;inset:0;background:#fff;background-image:linear-gradient(to right,#aaa 1px,transparent 1px),linear-gradient(to bottom,#aaa 1px,transparent 1px);background-size:10px 10px}
        [data-board-element=true]{position:absolute;left:20px;top:15px;width:60px;height:50px;box-sizing:border-box;background:#fff;border:4px solid #000}
        [data-selection-outline=true]{position:absolute;left:0;top:10px;width:100px;height:1px;background:#00ff00}
        iframe{position:absolute;left:70px;top:10px;width:40px;height:30px;border:0}
      </style>
      <div data-board-root="true">
        <div data-board-surface="true"></div>
        <div data-board-element="true"></div>
        <div data-selection-outline="true"></div>
        <iframe title="embedded web"></iframe>
      </div>
    `);
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const documentRoot = document.documentElement;
      documentRoot.setAttribute('data-noteboard-fill-capture', 'true');
      const style = document.createElement('style');
      style.textContent = `html[data-noteboard-fill-capture="true"] [data-board-surface]{background-image:none!important} html[data-noteboard-fill-capture="true"] [data-selection-outline]{visibility:hidden!important}`;
      document.head.appendChild(style);
      try {
        const root = document.querySelector('[data-board-root]');
        const rect = root.getBoundingClientRect();
        const capture = await BrowserBoardCapture.captureBoardRegionFromDOM(root, {
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        }, 1);
        const image = new Image();
        image.src = capture.dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const sample = (x, y) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
        return { dataUrl: capture.dataUrl, excludedRects: capture.excludedRects, width: canvas.width, height: canvas.height, grid: sample(0, 5), outline: sample(21, 40), interior: sample(50, 40), overlay: sample(50, 10) };
      } finally {
        style.remove();
        documentRoot.removeAttribute('data-noteboard-fill-capture');
      }
    });
    assert.deepEqual({ width: result.width, height: result.height }, { width: 100, height: 80 });
    assert.deepEqual(result.excludedRects, [{ x: 70, y: 10, width: 30, height: 30 }]);
    assert.deepEqual(result.grid, [255, 255, 255]);
    assert.deepEqual(result.outline, [0, 0, 0]);
    assert.deepEqual(result.interior, [255, 255, 255]);
    assert.deepEqual(result.overlay, [255, 255, 255]);
  } finally {
    await browser.close();
  }
});

test('browser board capture limits raster work to the requested pixels at high zoom', async () => {
  const bundled = await bundleCaptureHelper();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 180, height: 140 } });
    await page.setContent(`
      <style>
        html,body{margin:0;width:180px;height:140px}
        [data-board-root]{position:absolute;left:0;top:0;width:6000px;height:4000px;overflow:visible;transform:scale(6);transform-origin:top left}
        [data-board-surface]{position:absolute;inset:0;background:#fff}
        [data-board-element=true]{position:absolute}
        #inside{left:20px;top:15px;width:80px;height:60px;background:#f00}
        #outside{left:5500px;top:3500px;width:200px;height:200px;background:#0f0}
      </style>
      <div data-board-root="true">
        <div data-board-surface="true"></div>
        <div id="inside" data-board-element="true"></div>
        <div id="outside" data-board-element="true"></div>
      </div>
    `);
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const root = document.querySelector('[data-board-root]');
      const rect = root.getBoundingClientRect();
      const capture = await BrowserBoardCapture.captureBoardRegionFromDOM(root, {
        left: rect.left + 30 * 6,
        top: rect.top + 25 * 6,
        right: rect.left + 40 * 6,
        bottom: rect.top + 35 * 6,
      }, 6);
      const image = new Image();
      image.src = capture.dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixel: [...context.getImageData(30, 30, 1, 1).data] };
    });
    assert.deepEqual(result, { width: 60, height: 60, pixel: [255, 0, 0, 255] });
  } finally {
    await browser.close();
  }
});
