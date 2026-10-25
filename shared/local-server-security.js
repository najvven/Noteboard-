const TRUSTED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const parseHostname = (value) => {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
};

export const isTrustedLocalHost = (host) =>
  TRUSTED_LOCAL_HOSTS.has(parseHostname(String(host ?? "")));

export const isTrustedLocalOrigin = (origin) => {
  try {
    const parsed = new URL(String(origin ?? ""));
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      TRUSTED_LOCAL_HOSTS.has(parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase())
    );
  } catch {
    return false;
  }
};

export const getLocalSecurityHeaders = () => ({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});
