import { getDomain } from "tldts";

const hostnameFromUrl = (value) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const registrableDomain = (hostname) =>
  getDomain(hostname, { allowPrivateDomains: true }) || hostname;

export const isThirdPartySite = (requestUrl, topLevelUrl) => {
  const requestHost = hostnameFromUrl(requestUrl);
  const topHost = hostnameFromUrl(topLevelUrl);
  if (!requestHost || !topHost) return false;
  return registrableDomain(requestHost) !== registrableDomain(topHost);
};
