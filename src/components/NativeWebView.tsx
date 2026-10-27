import React, { useLayoutEffect, useRef, useState } from 'react';
import type { BoardElement } from '../types';
import { normalizeWebUrl } from '../features/web/model';

interface GuestElement extends HTMLElement {
  getWebContentsId(): number;
  getURL(): string;
  loadURL(url: string): Promise<void>;
}

type Props = {
  key?: React.Key;
  elementId: string;
  src: string;
  partition: string;
  deviceMode: NonNullable<BoardElement['webDeviceMode']>;
  interactive: boolean;
  guestRef: React.MutableRefObject<any>;
  onReady: () => void;
  onLoading: () => void;
  onNavigate: (url: string) => void;
  onError: (message: string) => void;
};

/** Owns the native viewport lifecycle; the surrounding board owns URL/session state. */
export default function NativeWebView(props: Props) {
  const hostZoom = () => window.noteboardAPI?.getWebHostZoom?.() || 1;
  const [displayZoom, setDisplayZoom] = useState(hostZoom);
  const [guestFullscreen, setGuestFullscreen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const requestNavigation = useRef<(() => void) | null>(null);
  const committedUrl = useRef('');
  const fullscreenRequestPending = useRef(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const guest = props.guestRef.current as GuestElement | null;
    if (!viewport || !guest) return;
    let disposed = false, attached = false, initialized = false, failedNavigation = false;
    let lastRequested = '', pendingFrame = 0;
    const reportError = (error: unknown) => {
      if (!disposed) latest.current.onError(error instanceof Error ? error.message : 'The page could not be loaded.');
    };
    const navigate = () => {
      if (!initialized || disposed) return;
      const url = latest.current.src;
      if (!url || normalizeWebUrl(lastRequested) === normalizeWebUrl(url)) return;
      lastRequested = url;
      guest.setAttribute('data-web-requested-url', url);
      guest.setAttribute('data-web-navigation-pending', 'true');
      failedNavigation = false;
      guest.loadURL(url).catch(error => {
        // A newer navigation or unmount may cancel a pending load.
        if (lastRequested === url && !String(error).includes('ERR_ABORTED')) reportError(error);
      });
    };
    requestNavigation.current = navigate;
    const configure = async () => {
      if (!attached || disposed) return false;
      const api = window.noteboardAPI;
      if (!api?.configureWebViewport) throw new Error('Please restart the desktop app to update its Web browser.');
      const applied = await api.configureWebViewport({
        guestId: guest.getWebContentsId(), deviceMode: latest.current.deviceMode,
        width: viewport.clientWidth, height: viewport.clientHeight,
      });
      if (!applied) throw new Error('Could not configure the Web viewport.');
      return !disposed;
    };
    const ready = async () => {
      attached = true;
      try {
        if (!await configure()) return;
        if (!initialized) {
          // Apply device metrics, touch and UA before the first website script/request.
          initialized = true;
          navigate();
        } else if (!failedNavigation && (guest.getURL() !== 'about:blank' || latest.current.src === 'about:blank')) {
          latest.current.onReady();
        }
      } catch (error) { reportError(error); }
    };
    const resized = () => {
      setDisplayZoom(hostZoom());
      cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(() => { void configure().catch(reportError); });
    };
    const navigated = (event: any, eventUrl?: string, isMainFrame?: boolean) => {
      if (!initialized || event?.isMainFrame === false || isMainFrame === false) return;
      if (event?.type === 'did-navigate-in-page' && event?.isMainFrame !== true && isMainFrame !== true) return;
      const url = normalizeWebUrl(typeof eventUrl === 'string' ? eventUrl : event?.url);
      if (!url || url === 'about:blank') return;
      if (guest.getAttribute('data-web-navigation-pending') === 'true' &&
          normalizeWebUrl(lastRequested) !== url) return;
      lastRequested = url;
      committedUrl.current = url;
      guest.setAttribute('data-web-requested-url', url);
      guest.removeAttribute('data-web-navigation-pending');
      latest.current.onNavigate(url);
    };
    const started = () => { if (initialized) latest.current.onLoading(); };
    const navigationStarted = (event: any) => {
      if (!event.isMainFrame || event.isInPlace) return;
      const url = normalizeWebUrl(event.url);
      if (url && url !== 'about:blank') {
        lastRequested = url;
        guest.setAttribute('data-web-requested-url', url);
        guest.setAttribute('data-web-navigation-pending', 'true');
      }
      failedNavigation = false;
    };
    const navigationRedirected = (event: any) => {
      if (!event.isMainFrame) return;
      const url = normalizeWebUrl(event.url);
      if (!url || url === 'about:blank') return;
      lastRequested = url;
      guest.setAttribute('data-web-requested-url', url);
      guest.setAttribute('data-web-navigation-pending', 'true');
    };
    const failed = (event: any) => {
      if (event.isMainFrame !== false && event.errorCode !== -3 && initialized) {
        const url = normalizeWebUrl(event.url);
        if (url && normalizeWebUrl(lastRequested) && url !== normalizeWebUrl(lastRequested)) return;
        failedNavigation = true;
        reportError(event.errorDescription || 'The page could not be loaded.');
      }
    };
    const crashed = () => reportError('The Web page stopped responding. Please retry.');
    const enterFullscreen = () => {
      fullscreenRequestPending.current = true;
      setGuestFullscreen(true);
    };
    const leaveFullscreen = () => {
      if (document.fullscreenElement === guest) {
        void document.exitFullscreen().catch(() => setGuestFullscreen(false));
      } else setGuestFullscreen(false);
    };
    const syncHostFullscreen = () => {
      if (document.fullscreenElement !== guest) setGuestFullscreen(false);
    };
    guest.addEventListener('dom-ready', ready);
    guest.addEventListener('did-navigate', navigated);
    guest.addEventListener('did-navigate-in-page', navigated);
    guest.addEventListener('did-start-loading', started);
    guest.addEventListener('did-start-navigation', navigationStarted);
    guest.addEventListener('did-redirect-navigation', navigationRedirected);
    guest.addEventListener('did-fail-load', failed);
    guest.addEventListener('render-process-gone', crashed);
    guest.addEventListener('enter-html-full-screen', enterFullscreen);
    guest.addEventListener('leave-html-full-screen', leaveFullscreen);
    document.addEventListener('fullscreenchange', syncHostFullscreen);
    const observer = new ResizeObserver(resized);
    observer.observe(viewport);
    window.addEventListener('resize', resized);
    window.visualViewport?.addEventListener('resize', resized);
    return () => {
      disposed = true;
      requestNavigation.current = null;
      cancelAnimationFrame(pendingFrame);
      observer.disconnect();
      window.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('resize', resized);
      guest.removeEventListener('dom-ready', ready);
      guest.removeEventListener('did-navigate', navigated);
      guest.removeEventListener('did-navigate-in-page', navigated);
      guest.removeEventListener('did-start-loading', started);
      guest.removeEventListener('did-start-navigation', navigationStarted);
      guest.removeEventListener('did-redirect-navigation', navigationRedirected);
      guest.removeEventListener('did-fail-load', failed);
      guest.removeEventListener('render-process-gone', crashed);
      guest.removeEventListener('enter-html-full-screen', enterFullscreen);
      guest.removeEventListener('leave-html-full-screen', leaveFullscreen);
      document.removeEventListener('fullscreenchange', syncHostFullscreen);
    };
  }, []);

  useLayoutEffect(() => {
    if (!guestFullscreen || !fullscreenRequestPending.current) return;
    fullscreenRequestPending.current = false;
    const guest = props.guestRef.current as GuestElement | null;
    if (!guest) {
      setGuestFullscreen(false);
      return;
    }
    void window.noteboardAPI?.enterWebFullscreen(guest.getWebContentsId()).then(entered => {
      if (!entered) setGuestFullscreen(false);
    }).catch(error => {
      setGuestFullscreen(false);
      console.warn('Could not enter Web fullscreen.', error);
    });
  }, [guestFullscreen]);

  useLayoutEffect(() => { requestNavigation.current?.(); }, [props.src]);

  return <div ref={viewportRef} data-web-viewport={props.deviceMode} className="relative h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
    {React.createElement('webview', {
      ref: props.guestRef, src: 'about:blank', partition: props.partition, allowpopups: 'true',
      'data-web-element-id': props.elementId, 'data-web-requested-url': props.src,
      'data-web-navigation-pending': normalizeWebUrl(props.src) &&
        normalizeWebUrl(props.src) !== normalizeWebUrl(committedUrl.current) ? 'true' : undefined,
      className: props.interactive ? 'pointer-events-auto' : 'pointer-events-none',
      // Electron sizes guests in host DIPs, unlike iframes. Cancel host zoom in
      // layout, then restore it at compositing so app/board zoom never reflows a page.
      style: guestFullscreen
        ? { display: 'flex', position: 'absolute', left: 0, top: 0,
            width: '100%', height: '100%', transform: 'none', transformOrigin: '0 0', background: '#000' }
        : { display: 'flex', position: 'absolute', left: 0, top: 0,
            width: `${100 / displayZoom}%`, height: `${100 / displayZoom}%`,
            transform: `scale(${displayZoom})`, transformOrigin: '0 0', background: 'white' },
    })}
  </div>;
}
