const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "I",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

const BLOCKED_TAGS = new Set([
  "EMBED",
  "FORM",
  "IFRAME",
  "IMG",
  "INPUT",
  "LINK",
  "META",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "SVG",
  "TEMPLATE",
]);

export const internalRichTextTargetId = (value: string) =>
  /^#target-([a-z0-9_-]+)$/i.exec(value.trim())?.[1] ?? null;

const sanitizeHref = (value: string) => {
  const trimmed = value.trim();
  const targetId = internalRichTextTargetId(trimmed);
  if (targetId !== null) return "#target-" + targetId;
  try {
    const url = new URL(trimmed, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? trimmed
      : "";
  } catch {
    return "";
  }
};

const sanitizeStyle = (value: string) => {
  const source = document.createElement("span");
  source.style.cssText = value;
  const safe: string[] = [];
  const color = source.style.color;
  const decoration = source.style.textDecoration;
  const cursor = source.style.cursor;
  const fontSize = source.style.fontSize;
  const fontWeight = source.style.fontWeight;
  const fontStyle = source.style.fontStyle;
  const lineHeight = source.style.lineHeight;
  const letterSpacing = source.style.letterSpacing;
  const wordSpacing = source.style.wordSpacing;
  const textAlign = source.style.textAlign;
  const fontFamily = source.style.fontFamily;
  if (isSafeColor(color)) safe.push(`color:${color}`);
  if (/^(?:none|underline)$/i.test(decoration)) {
    safe.push(`text-decoration:${decoration}`);
  }
  if (cursor === "pointer") safe.push("cursor:pointer");
  if (isSafeFontSize(fontSize)) safe.push(`font-size:${fontSize}`);
  if (/^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(fontWeight)) {
    safe.push(`font-weight:${fontWeight}`);
  }
  if (/^(?:normal|italic|oblique)$/i.test(fontStyle)) {
    safe.push(`font-style:${fontStyle}`);
  }
  if (isSafeLineHeight(lineHeight)) safe.push(`line-height:${lineHeight}`);
  if (isSafeSpacing(letterSpacing)) safe.push(`letter-spacing:${letterSpacing}`);
  if (isSafeSpacing(wordSpacing)) safe.push(`word-spacing:${wordSpacing}`);
  if (/^(?:left|right|center|justify|start|end)$/i.test(textAlign)) {
    safe.push(`text-align:${textAlign}`);
  }
  if (isSafeFontFamily(fontFamily)) safe.push(`font-family:${fontFamily}`);
  return safe.join(";");
};

const isSafeColor = (value: string) =>
  /^(?:#[0-9a-f]{3,8}|[a-z]{1,32}|(?:rgb|rgba|hsl|hsla)\([0-9.%\s,+/-]+\))$/i.test(value);

const isSafeFontSize = (value: string) =>
  /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|(?:\d+(?:\.\d+)?)(?:px|pt|pc|in|cm|mm|em|rem|ex|ch|%)?)$/i.test(value);

const isSafeLineHeight = (value: string) =>
  /^(?:normal|\d+(?:\.\d+)?|(?:\d+(?:\.\d+)?)(?:px|pt|pc|in|cm|mm|em|rem|ex|ch|%))$/i.test(value);

const isSafeSpacing = (value: string) =>
  /^(?:normal|(?:-?\d+(?:\.\d+)?)(?:px|pt|pc|in|cm|mm|em|rem|ex|ch|%))$/i.test(value);

const isSafeFontFamily = (value: string) =>
  /^(?:(?:"[a-z0-9 _-]+"|'[a-z0-9 _-]+'|[a-z][a-z0-9_-]*)(?:\s*,\s*(?:"[a-z0-9 _-]+"|'[a-z0-9 _-]+'|[a-z][a-z0-9_-]*))*)$/i.test(value);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function sanitizeRichText(value: string): string {
  if (!value) return "";
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return escapeHtml(value);
  }

  const parsed = new DOMParser().parseFromString(value, "text/html");
  parsed.body
    .querySelectorAll<HTMLElement>('[data-noteboard-text-presentation="caret-run"]')
    .forEach((element) => {
      const walker = parsed.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const markerIndex = node.data.indexOf("\u200b");
        if (markerIndex < 0) continue;
        node.deleteData(markerIndex, 1);
        break;
      }
      const hasNonTextChild = Array.from(element.childNodes).some((node) => node.nodeType !== Node.TEXT_NODE);
      if (!element.textContent && !hasNonTextChild) {
        element.remove();
      } else {
        while (element.firstChild) element.parentNode?.insertBefore(element.firstChild, element);
        element.remove();
      }
    });
  parsed.body
    .querySelectorAll<HTMLElement>("[data-noteboard-text-presentation]")
    .forEach((element) => {
      const presentation = element.getAttribute("data-noteboard-text-presentation");
      if (element.tagName === "SPAN" && (presentation === "line-grid-run" || presentation === "line-grid-overflow")) {
        while (element.firstChild) element.parentNode?.insertBefore(element.firstChild, element);
        element.remove();
      } else if (element.tagName === "DIV" && presentation === "line-grid-block") {
        if (!element.childNodes.length) element.appendChild(parsed.createElement("br"));
        element.removeAttribute("data-noteboard-text-presentation");
      } else {
        element.removeAttribute("data-noteboard-text-presentation");
      }
    });
  parsed.body.querySelectorAll("*").forEach((element) => {
    if (BLOCKED_TAGS.has(element.tagName)) {
      element.remove();
      return;
    }
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent ?? ""));
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name === "href" && element.tagName === "A") {
        const safeHref = sanitizeHref(attribute.value);
        if (safeHref) element.setAttribute("href", safeHref);
        else element.removeAttribute("href");
        return;
      }
      if (attribute.name === "style") {
        const safeStyle = sanitizeStyle(attribute.value);
        if (safeStyle) element.setAttribute("style", safeStyle);
        else element.removeAttribute("style");
        return;
      }
      element.removeAttribute(attribute.name);
    });

    if (element.tagName === "A") {
      element.setAttribute("rel", "noopener noreferrer");
      if (internalRichTextTargetId(element.getAttribute("href") || "") === null) {
        element.setAttribute("target", "_blank");
      }
    }
  });
  parsed.body
    .querySelectorAll<HTMLElement>("p, div, li, blockquote, h1, h2, h3")
    .forEach((element) => {
      if (!element.childNodes.length) element.appendChild(parsed.createElement("br"));
    });
  return parsed.body.innerHTML;
}
