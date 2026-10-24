export function isAllowedMainWindowNavigation(value, options) {
  try {
    const candidate = new URL(value);
    if (candidate.username || candidate.password) return false;

    if (options.development) {
      const developmentOrigin = new URL(options.developmentOrigin);
      return (
        candidate.protocol === developmentOrigin.protocol &&
        candidate.origin === developmentOrigin.origin
      );
    }

    const productionEntry = new URL(options.productionEntry);
    return (
      candidate.protocol === "file:" &&
      productionEntry.protocol === "file:" &&
      candidate.host === productionEntry.host &&
      candidate.pathname === productionEntry.pathname
    );
  } catch {
    return false;
  }
}

export function isAllowedWebPartition(value) {
  return (
    typeof value === "string" &&
    /^(?:persist:)?noteboard-web-[a-zA-Z0-9_-]{1,200}$/.test(value)
  );
}

export function isAllowedEmbeddedWebUrl(value) {
  try {
    const candidate = new URL(value);
    if (candidate.username || candidate.password) return false;
    if (candidate.protocol === "about:") return candidate.href === "about:blank";
    return candidate.protocol === "http:" || candidate.protocol === "https:";
  } catch {
    return false;
  }
}
