export const normalizeWebUrl = (value?: string) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "about:blank") return "about:blank";

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    return candidate;
  } catch {
    return "";
  }
};
