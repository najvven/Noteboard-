import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";
import { chromium } from "playwright";

const helperPath = new URL("../../src/features/board/rich-text-formatting.ts", import.meta.url);
const sanitizerPath = new URL("../../src/lib/sanitize-rich-text.ts", import.meta.url);
const cssPath = new URL("../../src/index.css", import.meta.url);

test('many hidden paragraphs avoid line-list and marker work while retaining mixed-font canonical text',async()=>{
  const helperCode=await bundleModule(helperPath,'RichTextPresentation');
  const sanitizerCode=await bundleModule(sanitizerPath,'RichTextSanitizer');
  const css=await readFile(cssPath,'utf8');
  const start=css.indexOf('.text-lines-everywhere,'),end=css.indexOf('.content-editable-text[contenteditable="true"]',start);
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();
    for(const ruled of [false,true]) {
      await page.setContent(`<style>body{margin:0}${css.slice(start,end)}#frame{width:160px;height:50px}#editor{width:160px;font:16px/10px Arial;--text-line-spacing:10px;--text-line-start:4.5px;--text-line-end:5.5px}p{margin:0}</style><div id="frame"><div id="editor" contenteditable="true" class="content-editable-text ${ruled?'text-lines-everywhere':''}">${Array.from({length:1000},(_,index)=>`<p style="font-size:${[8,16,24][index%3]}px">Paragraph ${index}</p>`).join('')}</div></div>`);
      await page.addScriptTag({content:helperCode});await page.addScriptTag({content:sanitizerCode});
      const result=await page.evaluate(()=>{
        const editor=document.querySelector('#editor');
        RichTextPresentation.syncTextLinePresentation(editor);
        let lists=0,markers=0;
        const originalRects=Range.prototype.getClientRects,originalInsert=Node.prototype.insertBefore;
        Range.prototype.getClientRects=function(){lists++;return originalRects.call(this);};
        Node.prototype.insertBefore=function(node,reference){if(node instanceof HTMLElement&&node.hasAttribute('data-noteboard-text-layout-marker'))markers++;return originalInsert.call(this,node,reference);};
        try {RichTextPresentation.syncTextLineViewport(editor,50);}
        finally {Range.prototype.getClientRects=originalRects;Node.prototype.insertBefore=originalInsert;}
        const canonical=RichTextSanitizer.sanitizeRichText(editor.innerHTML);
        return {lists,markers,canonical,height:editor.getBoundingClientRect().height};
      });
      assert.ok(result.lists<30,JSON.stringify({...result,canonical:undefined}));
      assert.ok(result.markers<120,JSON.stringify({...result,canonical:undefined}));
      assert.ok(result.canonical.includes('Paragraph 999'));
      assert.equal((result.canonical.match(/Paragraph /g)||[]).length,1000);
      assert.ok(result.height<=50.1);
    }
  } finally {await browser.close();}
});

async function bundleModule(path, globalName) {
  const source = await readFile(path, "utf8");
  const { code } = await transform(source, {
    loader: "ts",
    format: "iife",
    globalName,
  });
  return code;
}

test("ruled empty lines keep a visible caret run during preedit without shifting the existing baseline", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const sanitizerCode = await bundleModule(sanitizerPath, "RichTextSanitizer");
  const css = await readFile(cssPath, "utf8");
  const start = css.indexOf(".text-lines-everywhere,");
  const end = css.indexOf('.content-editable-text[contenteditable="true"]', start);
  assert.ok(start >= 0 && end > start, "expected the ruled text CSS block");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.setContent(`
      <style>
        body { margin: 0; font-family: Arial, sans-serif; }
        ${css.slice(start, end)}
        #editor { width: 80px; font-size: 16px; --text-line-spacing: 10px; --text-line-start: 4.5px; --text-line-end: 5.5px; }
        p { margin: 0; }
      </style>
      <div id="editor" contenteditable="true" class="content-editable-text text-lines-everywhere">
        <p>Existing text</p>
        <p>Long text words should naturally wrap into several fixed grid lines</p>
        <p id="small-size" style="font-size:2px">Small baseline text</p>
        <p id="large-size" style="font-size:16px">Large baseline text</p>
        <p id="mixed-size" style="font-size:16px"><span style="font-size:2px">Tiny</span> <span style="font-size:16px">Regular</span></p>
        <p><br></p>
      </div>
    `);
    await page.addScriptTag({ content: helperCode });
    await page.addScriptTag({ content: sanitizerCode });
    const result = await page.evaluate(() => {
      const findText = (root, needle) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.data.includes(needle)) return node;
        }
        return null;
      };
      const editor = document.querySelector("#editor");
      RichTextPresentation.syncTextLinePresentation(editor);
      const paragraphs = editor.querySelectorAll("p");
      const [existingLine, wrappedLine, , , , emptyLine] = paragraphs;
      const existingText = findText(existingLine, "Existing text");
      const existingRange = document.createRange();
      existingRange.selectNodeContents(existingText);
      const wrappedText = findText(wrappedLine, "Long text");
      const wrappedRange = document.createRange();
      wrappedRange.selectNodeContents(wrappedText);
      const wrappedRects = Array.from(wrappedRange.getClientRects()).map((rect) => rect.toJSON());
      const wrappedRows = [...new Set(wrappedRects.map((rect) => rect.y))].sort((a, b) => a - b);
      const baselineOffset = (block, needle) => {
        const text = findText(block, needle);
        const run = text.parentElement.closest('[data-noteboard-text-presentation="line-grid-run"]');
        const fontSize = Number.parseFloat(getComputedStyle(run).fontSize);
        const context = document.createElement("canvas").getContext("2d");
        context.font = `${fontSize}px Arial`;
        const ascent = context.measureText("H").fontBoundingBoxAscent;
        const range = document.createRange();
        range.selectNodeContents(text);
        return range.getBoundingClientRect().top + ascent - block.getBoundingClientRect().top;
      };
      const nativeBaselineOffset = (block, needle) => {
        const text = findText(block, needle);
        const run = text.parentElement.closest('[data-noteboard-text-presentation="line-grid-run"]');
        const marker = document.createElement("span");
        marker.style.cssText = "display:inline-block;width:0;height:0;margin:0;padding:0;border:0;line-height:0;vertical-align:baseline";
        run.insertBefore(marker, run.firstChild);
        const offset = marker.getBoundingClientRect().top - block.getBoundingClientRect().top;
        marker.remove();
        return offset;
      };
      const lineStart = Number.parseFloat(getComputedStyle(editor).getPropertyValue("--text-line-start"));
      const lineEnd = Number.parseFloat(getComputedStyle(editor).getPropertyValue("--text-line-end"));
      const expectedBaselineOffset = (lineStart + lineEnd) / 2;
      const baselineOffsets = [
        baselineOffset(editor.querySelector("#small-size"), "Small"),
        baselineOffset(editor.querySelector("#large-size"), "Large"),
      ];
      const nativeBaselineOffsets = [
        nativeBaselineOffset(editor.querySelector("#small-size"), "Small"),
        nativeBaselineOffset(editor.querySelector("#large-size"), "Large"),
      ];
      const mixedOffsets = [
        baselineOffset(editor.querySelector("#mixed-size"), "Tiny"),
        baselineOffset(editor.querySelector("#mixed-size"), "Regular"),
      ];
      const mixedNativeBaselineOffsets = [
        nativeBaselineOffset(editor.querySelector("#mixed-size"), "Tiny"),
        nativeBaselineOffset(editor.querySelector("#mixed-size"), "Regular"),
      ];
      const before = {
        line: existingLine.getBoundingClientRect().toJSON(),
        glyph: existingRange.getBoundingClientRect().toJSON(),
        wrappedBlock: wrappedLine.getBoundingClientRect().toJSON(),
        wrappedRects,
        wrappedRows,
        baselineOffsets,
        nativeBaselineOffsets,
        mixedOffsets,
        mixedNativeBaselineOffsets,
        expectedBaselineOffset,
        emptyBlock: emptyLine.getBoundingClientRect().toJSON(),
        pitch: getComputedStyle(existingLine).lineHeight,
        background: getComputedStyle(editor).backgroundImage,
      };

      const emptyRange = document.createRange();
      emptyRange.setStart(emptyLine, 0);
      emptyRange.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(emptyRange);
      RichTextPresentation.focusEmptyTextLineCaret(editor);
      const caretRun = emptyLine.querySelector('[data-noteboard-text-presentation="caret-run"]');
      const caretText = caretRun.firstChild;
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      caretText.data += "漢";
      const preeditRange = document.createRange();
      preeditRange.setStart(caretText, 1);
      preeditRange.setEnd(caretText, 2);
      const preedit = preeditRange.getBoundingClientRect().toJSON();
      const during = {
        line: existingLine.getBoundingClientRect().toJSON(),
        wrappedBlock: wrappedLine.getBoundingClientRect().toJSON(),
        pitch: getComputedStyle(existingLine).lineHeight,
        background: getComputedStyle(editor).backgroundImage,
        visiblePreedit: preedit.width > 0 && preedit.height > 0,
        classes: editor.className,
      };

      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      RichTextPresentation.syncTextLinePresentation(editor);
      const finalText = findText(emptyLine, "漢");
      const finalRange = document.createRange();
      finalRange.selectNodeContents(finalText);
      const after = {
        line: existingLine.getBoundingClientRect().toJSON(),
        wrappedBlock: wrappedLine.getBoundingClientRect().toJSON(),
        pitch: getComputedStyle(existingLine).lineHeight,
        background: getComputedStyle(editor).backgroundImage,
        text: editor.textContent,
        hasCaretRun: Boolean(editor.querySelector('[data-noteboard-text-presentation="caret-run"]')),
        canonical: RichTextSanitizer.sanitizeRichText(editor.innerHTML),
        finalGlyph: finalRange.getBoundingClientRect().toJSON(),
      };
      return { before, during, after };
    });

    assert.equal(result.before.pitch, "10px");
    assert.ok(result.before.wrappedRects.length > 1, "long text should wrap into multiple visual rows");
    assert.ok(result.before.wrappedBlock.height > 0, "wrapped paragraph should keep its fixed-grid height");
    assert.ok(result.before.wrappedRows.length > 1, "wrapped glyphs should occupy distinct rows");
    for (let index = 1; index < result.before.wrappedRows.length; index += 1) {
      assert.ok(
        Math.abs(result.before.wrappedRows[index] - result.before.wrappedRows[index - 1] - 10) < 0.1,
        JSON.stringify({ rows: result.before.wrappedRows, block: result.before.wrappedBlock, rects: result.before.wrappedRects }),
      );
    }
    assert.equal(result.before.emptyBlock.height, 10, "empty ruled paragraph should keep one row");
    assert.ok(result.before.nativeBaselineOffsets.every((offset) => Math.abs(offset - result.before.expectedBaselineOffset) < 1), JSON.stringify(result.before));
    assert.ok(result.before.mixedNativeBaselineOffsets.every((offset) => Math.abs(offset - result.before.expectedBaselineOffset) < 1), JSON.stringify(result.before));
    assert.equal(result.during.pitch, "10px");
    assert.equal(result.after.pitch, "10px");
    assert.equal(result.during.visiblePreedit, true);
    assert.match(result.during.classes, /text-lines-everywhere/);
    assert.equal(result.during.background, result.before.background);
    assert.deepEqual(result.during.line, result.before.line);
    assert.deepEqual(result.after.line, result.before.line);
    assert.deepEqual(result.during.wrappedBlock, result.before.wrappedBlock);
    assert.deepEqual(result.after.wrappedBlock, result.before.wrappedBlock);
    assert.equal(result.after.background, result.before.background);
    assert.equal(result.after.text.replace(/\s/g, ""), "ExistingtextLongtextwordsshouldnaturallywrapintoseveralfixedgridlinesSmallbaselinetextLargebaselinetextTinyRegular漢");
    assert.equal(result.after.hasCaretRun, false);
    assert.ok(!result.after.canonical.includes("data-noteboard-text-presentation"));
    assert.ok(!result.after.canonical.includes("\u200b"));
    assert.ok(result.after.finalGlyph.width > 0 && result.after.finalGlyph.height > 0);
  } finally {
    await browser.close();
  }
});

test("blocks-only presentation gives root-level text a ruled block without changing canonical text", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>
        ${await readFile(cssPath, "utf8").then((source) => {
          const start = source.indexOf(".text-lines-everywhere,");
          const end = source.indexOf('.content-editable-text[contenteditable="true"]', start);
          return source.slice(start, end);
        })}
        #editor { width: 260px; font-size: 16px; --text-line-spacing: 10px; --text-line-start: 4.5px; --text-line-end: 5.5px; }
      </style>
      <div id="editor" contenteditable="true" class="content-editable-text text-lines-blocks">Direct root text</div>
    `);
    await page.addScriptTag({ content: helperCode });
    const result = await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      RichTextPresentation.syncTextLinePresentation(editor);
      RichTextPresentation.syncTextLinePresentation(editor);
      const block = editor.querySelector('[data-noteboard-text-presentation="line-grid-block"]');
      return {
        text: editor.textContent,
        blockCount: editor.querySelectorAll("#editor > div").length,
        hasPresentationAttribute: Boolean(block),
        background: getComputedStyle(editor.firstElementChild).backgroundImage,
      };
    });
    assert.equal(result.text, "Direct root text");
    assert.equal(result.blockCount, 1);
    assert.equal(result.hasPresentationAttribute, false);
    assert.notEqual(result.background, "none");
  } finally {
    await browser.close();
  }
});

test("read-only ruled editors do not receive caret sentinels", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="editor" contenteditable="false" class="text-lines-everywhere"><p><br></p></div>');
    await page.addScriptTag({ content: helperCode });
    const result = await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      RichTextPresentation.syncTextLinePresentation(editor);
      return {
        editable: editor.isContentEditable,
        caretRuns: editor.querySelectorAll('[data-noteboard-text-presentation="caret-run"]').length,
        text: editor.textContent,
        class: editor.className,
      };
    });
    assert.equal(result.editable, false);
    assert.equal(result.caretRuns, 0);
    assert.equal(result.text, "");
    assert.match(result.class, /text-lines-everywhere/);
  } finally {
    await browser.close();
  }
});

test("range formatting across an empty ruled line skips the internal caret marker", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="editor" contenteditable="true" class="text-lines-everywhere"><p>Alpha</p><p><br></p><p>Omega</p></div>');
    await page.addScriptTag({ content: helperCode });
    const result = await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      RichTextPresentation.syncTextLinePresentation(editor);
      const paragraphs = editor.querySelectorAll("p");
      const findText = (root, needle) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.data.includes(needle)) return node;
        }
        return null;
      };
      const alpha = findText(paragraphs[0], "Alpha");
      const omega = findText(paragraphs[2], "Omega");
      const range = document.createRange();
      range.setStart(alpha, 0);
      range.setEnd(omega, omega.length);
      RichTextPresentation.colorTextRange(editor, range, "#ff0000");
      const caret = paragraphs[1].querySelector('[data-noteboard-text-presentation="caret-run"]');
      return {
        text: editor.textContent.replace(/\u200b/g, ""),
        caretText: caret?.textContent,
        nestedStyledElements: caret?.querySelectorAll("[style]").length ?? -1,
      };
    });
    assert.equal(result.text, "AlphaOmega");
    assert.equal(result.caretText, "\u200b");
    assert.equal(result.nestedStyledElements, 0);
  } finally {
    await browser.close();
  }
});

test("capacity masks later formatted siblings and restores a selected wrapped tail", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const sanitizerCode = await bundleModule(sanitizerPath, "RichTextSanitizer");
  const css = await readFile(cssPath, "utf8");
  const start = css.indexOf(".text-lines-everywhere,");
  const end = css.indexOf('.content-editable-text[contenteditable="true"]', start);
  assert.ok(start >= 0 && end > start, "expected the ruled text CSS block");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    await page.setContent(`
      <style>
        body { margin: 0; font-family: Arial, sans-serif; }
        ${css.slice(start, end)}
        #frame { width: 60px; height: 20px; }
        #editor { width: 60px; --text-line-spacing: 10px; --text-line-start: 4.5px; --text-line-end: 5.5px; }
        p { margin: 0; }
      </style>
      <div id="frame">
        <div id="editor" contenteditable="true" class="content-editable-text text-lines-everywhere">
          <p>A</p>
          <p><span style="font-size:16px">BBBBBBBBBBBB</span><b>TAIL</b></p>
          <ul><li><br></li></ul>
        </div>
      </div>
    `);
    await page.addScriptTag({ content: helperCode });
    await page.addScriptTag({ content: sanitizerCode });
    const result = await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      RichTextPresentation.syncTextLinePresentation(editor);
      const layout = RichTextPresentation.syncTextLineViewport(editor, 20);
      const wrappers = Array.from(editor.querySelectorAll('[data-noteboard-text-presentation="line-grid-overflow"]'));
      const wrapperInfo = wrappers.map((wrapper) => ({ text: wrapper.textContent, inBold: Boolean(wrapper.closest("b")) }));
      const bTail = wrappers.find((wrapper) => wrapper.textContent === "TAIL");
      const partialRun = wrappers.find((wrapper) => wrapper.textContent?.includes("B"));
      const partialText = partialRun?.firstChild;
      const emptyListItem = editor.querySelector("li");
      const selection = window.getSelection();
      if (!(partialText instanceof Text)) throw new Error("Expected a wrapped partial overflow text node");
      const range = document.createRange();
      range.selectNodeContents(partialText);
      selection.removeAllRanges();
      selection.addRange(range);
      const before = range.toString();
      const beforeAnchor = range.startContainer;
      const secondLayout = RichTextPresentation.syncTextLineViewport(editor, 20);
      return {
        fullRows: layout.fullRows,
        overflowOffsets: layout.overflowText.map((segment) => segment.offset),
        wrappers: wrapperInfo,
        hasFormattedSibling: Boolean(bTail),
        before,
        after: selection.toString(),
        retainedAnchor: selection.anchorNode === beforeAnchor,
        nextOverflowSegments: secondLayout.overflowText.length,
        emptyListItemMarked: emptyListItem?.getAttribute("data-noteboard-text-presentation") === "line-grid-overflow-block",
        emptyListMarkerColor: getComputedStyle(emptyListItem, "::marker").color,
        canonical: RichTextSanitizer.sanitizeRichText(editor.innerHTML),
      };
    });
    assert.equal(result.fullRows, 2);
    assert.ok(result.overflowOffsets.some((offset) => offset > 0), JSON.stringify(result));
    assert.ok(result.wrappers.some((wrapper) => wrapper.text.includes("B")), JSON.stringify(result));
    assert.ok(result.hasFormattedSibling, JSON.stringify(result));
    assert.ok(result.wrappers.some((wrapper) => wrapper.text === "TAIL" && wrapper.inBold), JSON.stringify(result));
    assert.ok(result.before.length > 0);
    assert.equal(result.after, result.before);
    assert.equal(result.retainedAnchor, true);
    assert.ok(result.nextOverflowSegments >= 2, JSON.stringify(result));
    assert.equal(result.emptyListItemMarked, true, JSON.stringify(result));
    assert.equal(result.emptyListMarkerColor, "rgba(0, 0, 0, 0)", JSON.stringify(result));
    assert.ok(result.canonical.includes("BBBBBBBBBBBB"));
    assert.ok(result.canonical.includes("<b>TAIL</b>"));
    assert.ok(!result.canonical.includes("data-noteboard-text-presentation"));
  } finally {
    await browser.close();
  }
});

test("paragraph preflight rejects a sixth ruled row after four blank Enter rows", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const css = await readFile(cssPath, "utf8");
  const start = css.indexOf(".text-lines-everywhere,");
  const end = css.indexOf('.content-editable-text[contenteditable="true"]', start);
  assert.ok(start >= 0 && end > start, "expected the ruled text CSS block");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    await page.setContent(`
      <style>
        body { margin: 0; font-family: Arial, sans-serif; }
        ${css.slice(start, end)}
        #frame { box-sizing: border-box; width: 260px; height: 61.99px; border: 1.5px solid transparent; }
        #editor { width: 260px; max-height: 61.99px; --text-line-spacing: 10px; --text-line-start: 4.5px; --text-line-end: 5.5px; }
        div { margin: 0; }
      </style>
      <div id="frame"><div id="editor" contenteditable="true" class="content-editable-text text-lines-everywhere text-line-capacity-limited"><span data-noteboard-text-presentation="line-grid-run" style="font-size:16px;line-height:10px">A</span><div><span data-noteboard-text-presentation="caret-run">\u200b</span></div><div><span data-noteboard-text-presentation="caret-run">\u200b</span></div><div><span data-noteboard-text-presentation="caret-run">\u200b</span></div><div><span data-noteboard-text-presentation="caret-run">\u200b</span></div></div></div>
    `);
    await page.addScriptTag({ content: helperCode });
    const result = await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      RichTextPresentation.syncTextLinePresentation(editor);
      const liveLayout = RichTextPresentation.syncTextLineViewport(editor, 61.99);
      const lastCaret = editor.querySelectorAll('[data-noteboard-text-presentation="caret-run"]')[3].firstChild;
      const range = document.createRange();
      range.setStart(lastCaret, lastCaret.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const candidate = RichTextPresentation.preflightTextInsertion(editor, range, "insertParagraph", "M", 61.99);
      return {
        liveRows: liveLayout.fullRows,
        liveViewportHeight: liveLayout.viewportHeight,
        allowed: Boolean(candidate),
        candidate: candidate && {
          fullRows: candidate.fullRows,
          viewportHeight: candidate.viewportHeight,
          rows: candidate.rows.map(({ top, bottom, inserted, insertedText, insertedBreak }) => ({ top, bottom, inserted, insertedText, insertedBreak })),
        },
        html: editor.innerHTML,
      };
    });
    assert.equal(result.liveRows, 5, JSON.stringify(result));
    assert.equal(result.liveViewportHeight, 50, JSON.stringify(result));
    assert.equal(result.allowed, false, JSON.stringify(result));
  } finally {
    await browser.close();
  }
});

test("90k hidden tail measures only visible rows plus the first overflow row", async () => {
  const helperCode = await bundleModule(helperPath, "RichTextPresentation");
  const sanitizerCode = await bundleModule(sanitizerPath, "RichTextSanitizer");
  const css = await readFile(cssPath, "utf8");
  const start = css.indexOf(".text-lines-everywhere,");
  const end = css.indexOf('.content-editable-text[contenteditable="true"]', start);
  assert.ok(start >= 0 && end > start, "expected the ruled text CSS block");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    await page.setContent(`
      <style>
        body { margin: 0; font-family: Arial, sans-serif; }
        ${css.slice(start, end)}
        #frame { width: 80px; height: 20px; }
        #editor { width: 80px; height: 20px; font-size: 16px; --text-line-spacing: 10px; --text-line-start: 4.5px; --text-line-end: 5.5px; }
        p { margin: 0; }
      </style>
      <div id="frame"><div id="editor" contenteditable="true" class="content-editable-text text-lines-everywhere"><p></p></div></div>
    `);
    const text = "X".repeat(90_000);
    await page.locator("#editor p").evaluate((paragraph, value) => paragraph.appendChild(document.createTextNode(value)), text);
    await page.addScriptTag({ content: helperCode });
    await page.addScriptTag({ content: sanitizerCode });
    const result = await page.evaluate(async () => {
      const editor = document.querySelector("#editor");
      const originalText = editor.querySelector("p").firstChild;
      const originalContent = originalText.data;
      RichTextPresentation.syncTextLinePresentation(editor);
      const run = editor.querySelector('[data-noteboard-text-presentation="line-grid-run"]');
      const measuredText = run.firstChild;
      const findOffset = (node, targetTop) => {
        let low = 0;
        let high = node.length;
        const topAt = (offset) => {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          return range.getBoundingClientRect().top;
        };
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (topAt(middle) < targetTop - 0.75) low = middle + 1;
          else high = middle;
        }
        for (let offset = Math.max(0, low - 2); offset < Math.min(node.length, low + 3); offset += 1) {
          if (Math.abs(topAt(offset) - targetTop) <= 0.75) return offset;
        }
        return Math.min(Math.max(0, low), Math.max(0, node.length - 1));
      };
      const markerAt = (node, offset) => {
        const suffix = node.splitText(offset);
        const marker = document.createElement("span");
        marker.style.cssText = "display:inline-block;width:0;height:0;margin:0;padding:0;border:0;line-height:0;vertical-align:baseline";
        suffix.parentNode.insertBefore(marker, suffix);
        const baseline = marker.getBoundingClientRect().top;
        marker.remove();
        node.appendData(suffix.data);
        suffix.remove();
        return baseline;
      };
      const clone = editor.cloneNode(true);
      clone.classList.remove("text-line-capacity-limited");
      clone.style.removeProperty("--text-line-viewport-height");
      clone.style.position = "fixed";
      clone.style.left = "-100000px";
      clone.style.top = "0";
      clone.style.width = getComputedStyle(editor).width;
      clone.style.height = "auto";
      clone.style.minHeight = "0";
      clone.style.maxHeight = "none";
      clone.style.overflow = "visible";
      clone.style.overflowX = "visible";
      clone.style.transform = "none";
      clone.style.visibility = "hidden";
      clone.style.pointerEvents = "none";
      clone.setAttribute("contenteditable", "true");
      document.body.appendChild(clone);
      const cloneText = clone.querySelector('[data-noteboard-text-presentation="line-grid-run"]').firstChild;
      const cloneTop = clone.getBoundingClientRect().top;
      const paddingTop = Number.parseFloat(getComputedStyle(clone).paddingTop) || 0;
      const lineCenter = (Number.parseFloat(getComputedStyle(editor).getPropertyValue("--text-line-start")) +
        Number.parseFloat(getComputedStyle(editor).getPropertyValue("--text-line-end"))) / 2;
      const targetBaseline = cloneTop + paddingTop + lineCenter + 20;
      const range = document.createRange();
      range.selectNodeContents(cloneText);
      const rects = Array.from(range.getClientRects());
      const seen = new Set();
      let expectedFirstOverflow;
      for (const rect of rects) {
        const key = Math.round(rect.top * 4) / 4;
        if (seen.has(key)) continue;
        seen.add(key);
        const offset = findOffset(cloneText, rect.top);
        if (markerAt(cloneText, offset) >= targetBaseline - 0.75) {
          expectedFirstOverflow = offset;
          break;
        }
      }
      clone.remove();

      let rangeRectReads = 0;
      let clientRectLists = 0;
      let markerReads = 0;
      let markerAdditions = 0;
      const originalRangeRect = Range.prototype.getBoundingClientRect;
      const originalClientRects = Range.prototype.getClientRects;
      const originalElementRect = HTMLElement.prototype.getBoundingClientRect;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.hasAttribute("data-text-layout-marker")) markerAdditions += 1;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Range.prototype.getBoundingClientRect = function (...args) {
        rangeRectReads += 1;
        return originalRangeRect.apply(this, args);
      };
      Range.prototype.getClientRects = function (...args) {
        clientRectLists += 1;
        return originalClientRects.apply(this, args);
      };
      HTMLElement.prototype.getBoundingClientRect = function (...args) {
        if (this.hasAttribute("data-text-layout-marker")) markerReads += 1;
        return originalElementRect.apply(this, args);
      };
      let layout;
      try {
        layout = RichTextPresentation.syncTextLineViewport(editor, 20);
        await Promise.resolve();
      } finally {
        observer.disconnect();
        Range.prototype.getBoundingClientRect = originalRangeRect;
        Range.prototype.getClientRects = originalClientRects;
        HTMLElement.prototype.getBoundingClientRect = originalElementRect;
      }
      const overflow = Array.from(editor.querySelectorAll('[data-noteboard-text-presentation="line-grid-overflow"]'));
      const hiddenText = overflow.map((wrapper) => wrapper.textContent).join("");
      const canonical = RichTextSanitizer.sanitizeRichText(editor.innerHTML);
      const canonicalHolder = document.createElement("div");
      canonicalHolder.innerHTML = canonical;
      return {
        inputLength: originalContent.length,
        fullRows: layout.fullRows,
        overflowOffset: layout.overflowText[0]?.offset,
        expectedFirstOverflow,
        rangeRectReads,
        clientRectLists,
        markerReads,
        markerAdditions,
        hiddenLength: hiddenText.length,
        hiddenStartsAtExpected: hiddenText === originalContent.slice(layout.overflowText[0]?.offset ?? 0),
        canonicalLength: canonicalHolder.textContent.length,
        canonicalTailPreserved: canonicalHolder.textContent === originalContent,
        hasInternalMarkers: canonical.includes("data-noteboard-text-presentation"),
      };
    });
    assert.equal(result.fullRows, 2, JSON.stringify(result));
    assert.equal(result.overflowOffset, result.expectedFirstOverflow, JSON.stringify(result));
    assert.ok(result.rangeRectReads < 200, JSON.stringify(result));
    assert.equal(result.clientRectLists, 1, JSON.stringify(result));
    assert.ok(result.markerAdditions <= 4, JSON.stringify(result));
    assert.equal(result.markerReads, result.markerAdditions, JSON.stringify(result));
    assert.ok(result.hiddenLength > 0, JSON.stringify(result));
    assert.equal(result.hiddenStartsAtExpected, true, JSON.stringify(result));
    assert.equal(result.canonicalLength, 90_000, JSON.stringify(result));
    assert.equal(result.canonicalTailPreserved, true, JSON.stringify(result));
    assert.equal(result.hasInternalMarkers, false, JSON.stringify(result));
  } finally {
    await browser.close();
  }
});
