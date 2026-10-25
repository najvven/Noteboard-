export const normalizeWebUrl = (value?: string) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "about:blank") return "about:blank";

  const hostWithPort = /^(?:[a-z\d-]+(?:\.[a-z\d-]+)*|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(trimmed);
  const candidate = hostWithPort
    ? `https://${trimmed}`
    : /^[a-z][a-z\d+.-]*:/i.test(trimmed)
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

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be']);

/** Full websites use Electron; browser previews use provider-supported embeds. */
export function getBrowserWebSource(value: string): { url: string; youtube: boolean; requiresDesktop: boolean } {
  const normalized = normalizeWebUrl(value);
  if (!normalized) return { url: '', youtube: false, requiresDesktop: false };
  const parsed = new URL(normalized);
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return { url: normalized, youtube: false, requiresDesktop: false };
  const segments = parsed.pathname.split('/').filter(Boolean);
  const id = parsed.hostname.toLowerCase() === 'youtu.be' ? segments[0]
    : parsed.pathname === '/watch' ? parsed.searchParams.get('v')
    : ['embed', 'shorts', 'live'].includes(segments[0]) ? segments[1] : undefined;
  const playlist = parsed.searchParams.get('list');
  const videoId = id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
  const validPlaylist = playlist && /^[a-zA-Z0-9_-]+$/.test(playlist) ? playlist : undefined;
  if (!videoId && !validPlaylist) return { url: normalized, youtube: true, requiresDesktop: true };
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${videoId || 'videoseries'}`);
  if (validPlaylist) embed.searchParams.set('list', validPlaylist);
  const time = parsed.searchParams.get('start') || parsed.searchParams.get('t') || '';
  let seconds = /^\d+$/.test(time) ? Number(time) : 0;
  if (/^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(time)) {
    seconds = Number(time.match(/(\d+)h/)?.[1] || 0) * 3600 + Number(time.match(/(\d+)m/)?.[1] || 0) * 60 + Number(time.match(/(\d+)s/)?.[1] || 0);
  }
  if (Number.isSafeInteger(seconds) && seconds > 0) embed.searchParams.set('start', String(seconds));
  return { url: embed.href, youtube: true, requiresDesktop: false };
}
