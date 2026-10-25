import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const helperPath = new URL('../../src/features/board/browser-region-capture.ts', import.meta.url);

test('browser board capture crops visible DOM pixels and suppresses grid and selection overlays', async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(helperPath)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'BrowserBoardCapture',
    platform: 'browser',
    target: 'es2020',
  });
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
      </style>
      <div data-board-root="true">
        <div data-board-surface="true"></div>
        <div data-board-element="true"></div>
        <div data-selection-outline="true"></div>
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
        return { dataUrl: capture.dataUrl, width: canvas.width, height: canvas.height, grid: sample(0, 5), outline: sample(21, 40), interior: sample(50, 40), overlay: sample(50, 10) };
      } finally {
        style.remove();
        documentRoot.removeAttribute('data-noteboard-fill-capture');
      }
    });
    assert.deepEqual({ width: result.width, height: result.height }, { width: 100, height: 80 });
    assert.deepEqual(result.grid, [255, 255, 255]);
    assert.deepEqual(result.outline, [0, 0, 0]);
    assert.deepEqual(result.interior, [255, 255, 255]);
    assert.deepEqual(result.overlay, [255, 255, 255]);
  } finally {
    await browser.close();
  }
});
