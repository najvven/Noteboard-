import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";
import { chromium } from "playwright";

const moduleSource = new URL("../../src/lib/sanitize-rich-text.ts", import.meta.url);

test("rich-text sanitizer preserves safe inline layout and drops active or layout CSS", async () => {
  const source = await readFile(moduleSource, "utf8");
  const { code } = await transform(source, {
    loader: "ts",
    format: "iife",
    globalName: "RichTextSanitizer",
  });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent("<main></main>");
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(() => {
      const safe = RichTextSanitizer.sanitizeRichText(
        '<span style="font-size:26px;font-weight:700;font-style:italic;line-height:1.4;letter-spacing:1px;word-spacing:2px;text-align:center;font-family:Arial, sans-serif;color:red">Styled</span>',
      );
      const unsafe = RichTextSanitizer.sanitizeRichText(
        '<span style="font-size:calc(100% + 2px);font-family:var(--payload);position:fixed;display:block;top:0;z-index:9;background-image:url(https://example.com/x)">Unsafe</span>',
      );
      const safeNode = document.createElement("div");
      safeNode.innerHTML = safe;
      const unsafeNode = document.createElement("div");
      unsafeNode.innerHTML = unsafe;
      return {
        safeStyle: safeNode.querySelector("span")?.getAttribute("style") ?? "",
        safeText: safeNode.textContent,
        unsafeStyle: unsafeNode.querySelector("span")?.getAttribute("style") ?? "",
        unsafeText: unsafeNode.textContent,
      };
    });

    assert.equal(result.safeText, "Styled");
    for (const property of [
      "font-size:26px",
      "font-weight:700",
      "font-style:italic",
      "line-height:1.4",
      "letter-spacing:1px",
      "word-spacing:2px",
      "text-align:center",
      "font-family:Arial, sans-serif",
      "color:red",
    ]) {
      assert.ok(result.safeStyle.includes(property), `expected preserved ${property}`);
    }
    assert.equal(result.unsafeText, "Unsafe");
    assert.equal(result.unsafeStyle, "");
  } finally {
    await browser.close();
  }
});
