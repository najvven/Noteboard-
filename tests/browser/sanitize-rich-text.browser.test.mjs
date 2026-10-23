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
      const presentationOnly = RichTextSanitizer.sanitizeRichText(
        '<span data-noteboard-text-presentation="line-grid-run" style="display:inline;font-size:16px;line-height:0">Visible text</span>',
      );
      const presentationBlock = RichTextSanitizer.sanitizeRichText(
        '<div data-noteboard-text-presentation="line-grid-block"><span data-noteboard-text-presentation="line-grid-run" style="display:inline;font-size:16px;line-height:0">Direct text</span></div>',
      );
      const emptyPresentationBlock = RichTextSanitizer.sanitizeRichText(
        '<div data-noteboard-text-presentation="line-grid-block"><span data-noteboard-text-presentation="caret-run">\u200b</span></div>',
      );
      const unknownPresentation = RichTextSanitizer.sanitizeRichText(
        '<span data-noteboard-text-presentation="future-marker">Keep this text</span>',
      );
      const caretPresentation = RichTextSanitizer.sanitizeRichText(
        '<span data-noteboard-text-presentation="caret-run" style="font-size:16px;line-height:0">\u200b漢</span>',
      );
      const emptyCaretPresentation = RichTextSanitizer.sanitizeRichText(
        '<span data-noteboard-text-presentation="caret-run">\u200b</span>',
      );
      const authoredZeroWidthSpace = RichTextSanitizer.sanitizeRichText('<span>\u200bAuthor text</span>');
      const safeNode = document.createElement("div");
      safeNode.innerHTML = safe;
      const unsafeNode = document.createElement("div");
      unsafeNode.innerHTML = unsafe;
      return {
        safeStyle: safeNode.querySelector("span")?.getAttribute("style") ?? "",
        safeText: safeNode.textContent,
        unsafeStyle: unsafeNode.querySelector("span")?.getAttribute("style") ?? "",
        unsafeText: unsafeNode.textContent,
        presentationOnly,
        presentationBlock,
        emptyPresentationBlock,
        unknownPresentation,
        caretPresentation,
        emptyCaretPresentation,
        authoredZeroWidthSpace,
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
    assert.equal(result.presentationOnly, "Visible text");
    assert.equal(result.presentationBlock, "<div>Direct text</div>");
    assert.equal(result.emptyPresentationBlock, "<div><br></div>");
    assert.equal(result.unknownPresentation, "<span>Keep this text</span>");
    assert.equal(result.caretPresentation, "漢");
    assert.equal(result.emptyCaretPresentation, "");
    assert.equal(result.authoredZeroWidthSpace, "<span>\u200bAuthor text</span>");
  } finally {
    await browser.close();
  }
});
