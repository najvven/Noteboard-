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

const sanitizeHref = (value: string) => {
  const trimmed = value.trim();
  if (/^#target-[a-z0-9_-]+$/i.test(trimmed)) return trimmed;
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
  if (color && !/url\s*\(/i.test(color)) safe.push(`color:${color}`);
  if (/^(?:none|underline)$/i.test(decoration)) {
    safe.push(`text-decoration:${decoration}`);
  }
  if (cursor === "pointer") safe.push("cursor:pointer");
  return safe.join(";");
};

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
      if (!element.getAttribute("href")?.startsWith("#target-")) {
        element.setAttribute("target", "_blank");
      }
    }
  });
  return parsed.body.innerHTML;
}
