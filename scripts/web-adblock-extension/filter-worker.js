import { FiltersEngine, Request } from '@ghostery/adblocker';

let engine;

self.onmessage = ({ data }) => {
  if (data?.type === 'init') {
    try {
      const binary = Uint8Array.from(atob(data.binary), character => character.charCodeAt(0));
      engine = FiltersEngine.deserialize(binary);
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'init-error', message: String(error?.message || error) });
    }
    return;
  }
  if (data?.type !== 'match' || !engine) return;
  try {
    const request = Request.fromRawDetails({ ...data.request, requestId: String(data.request.requestId ?? '') });
    const { match, redirect } = engine.match(request);
    self.postMessage({
      type: 'result',
      id: data.id,
      result: redirect ? { redirectUrl: redirect.dataUrl } : { cancel: match },
    });
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: String(error?.message || error) });
  }
};
