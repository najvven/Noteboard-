const MAX_QUEUED_FILTER_REQUESTS = 128;
const FILTER_MATCH_DEADLINE_MS = 150;
const FILTER_QUEUE_DEADLINE_MS = 5_000;

let policy = { enabled: false, topLevelUrl: '' };
let manifest;
let filterSnapshotBinary;
let worker;
let workerReady;
let workerReadyResolve;
let workerReadyReject;
let activeRequest;
let nextRequestId = 1;
let timeoutCount = 0;
let queueOverflowCount = 0;
const requestQueue = [];

function clearWorker() {
  const previous = worker;
  const rejectReady = workerReadyReject;
  worker = undefined;
  workerReady = undefined;
  workerReadyResolve = undefined;
  workerReadyReject = undefined;
  rejectReady?.(new Error('Ad-block worker was restarted.'));
  if (previous) {
    previous.onmessage = null;
    previous.onerror = null;
    previous.terminate();
  }
}

function failActiveRequest(error) {
  if (!activeRequest) return;
  const current = activeRequest;
  activeRequest = undefined;
  clearTimeout(current.matchTimer);
  current.reject(error);
}

function createWorker() {
  if (workerReady) return workerReady;
  if (!filterSnapshotBinary) return Promise.reject(new Error('Ad-block filters are not ready.'));
  const instance = new Worker(chrome.runtime.getURL('filter-worker.js'));
  worker = instance;
  workerReady = new Promise((resolve, reject) => {
    workerReadyResolve = resolve;
    workerReadyReject = reject;
    instance.onmessage = ({ data }) => {
      if (worker !== instance) return;
      if (data?.type === 'ready') {
        workerReadyResolve?.(instance);
        workerReadyResolve = undefined;
        workerReadyReject = undefined;
        return;
      }
      if (data?.type === 'init-error') {
        const error = new Error(data.message || 'Ad-block worker could not load its filters.');
        workerReadyReject?.(error);
        workerReadyResolve = undefined;
        workerReadyReject = undefined;
        clearWorker();
        return;
      }
      if (!activeRequest || data?.id !== activeRequest.id) return;
      const current = activeRequest;
      activeRequest = undefined;
      clearTimeout(current.matchTimer);
      if (data.type === 'error') current.reject(new Error(data.message || 'Ad-block matching failed.'));
      else current.resolve(data.result || { cancel: false });
      processRequestQueue();
    };
    instance.onerror = (event) => {
      event.preventDefault?.();
      const error = new Error('Ad-block worker stopped unexpectedly.');
      workerReadyReject?.(error);
      workerReadyResolve = undefined;
      workerReadyReject = undefined;
      failActiveRequest(error);
      clearWorker();
      processRequestQueue();
    };
    instance.postMessage({ type: 'init', binary: filterSnapshotBinary });
  }).catch((error) => {
    if (worker === instance) clearWorker();
    throw error;
  });
  return workerReady;
}

async function processRequestQueue() {
  if (activeRequest || !requestQueue.length) return;
  const current = requestQueue.shift();
  clearTimeout(current.queueTimer);
  activeRequest = current;
  current.matchTimer = setTimeout(() => {
    if (activeRequest !== current) return;
    activeRequest = undefined;
    timeoutCount += 1;
    clearTimeout(current.matchTimer);
    current.resolve({ cancel: false });
    clearWorker();
    console.warn('Ad-block matching exceeded its 150 ms budget; the worker was restarted.');
    void processRequestQueue();
  }, FILTER_MATCH_DEADLINE_MS);
  try {
    const readyWorker = await createWorker();
    if (activeRequest !== current) return;
    readyWorker.postMessage({ type: 'match', id: current.id, request: current.request });
  } catch (error) {
    if (activeRequest !== current) return;
    activeRequest = undefined;
    clearTimeout(current.matchTimer);
    current.reject(error);
    void processRequestQueue();
  }
}

function filterRequest(details) {
  if (!manifest || !filterSnapshotBinary) throw new Error('Ad-block filters are not ready.');
  if (details.type === 'main_frame' || !policy.enabled) {
    if (details.type === 'main_frame') policy.topLevelUrl = details.url || policy.topLevelUrl;
    return Promise.resolve({});
  }
  if (requestQueue.length >= MAX_QUEUED_FILTER_REQUESTS) {
    queueOverflowCount += 1;
    return Promise.reject(new Error('Ad-block request queue is full.'));
  }
  const request = {
    url: details.url,
    type: details.type,
    requestId: details.requestId,
    tabId: details.tabId,
    sourceUrl: details.initiator || details.originUrl || details.documentUrl || policy.topLevelUrl,
  };
  return new Promise((resolve, reject) => {
    const job = { id: nextRequestId++, request, resolve, reject };
    job.queueTimer = setTimeout(() => {
      const index = requestQueue.indexOf(job);
      if (index < 0) return;
      requestQueue.splice(index, 1);
      queueOverflowCount += 1;
      reject(new Error('Ad-block request waited too long for the matcher.'));
    }, FILTER_QUEUE_DEADLINE_MS);
    requestQueue.push(job);
    void processRequestQueue();
  });
}

globalThis.noteboardAdBlock = {
  filterRequest,
  async configure(next) {
    if (!manifest || manifest.sha256 !== next.manifest.sha256) {
      clearWorker();
      failActiveRequest(new Error('The ad-block filter snapshot changed.'));
      filterSnapshotBinary = next.binary;
      manifest = next.manifest;
    }
    policy = { enabled: next.enabled === true, topLevelUrl: next.topLevelUrl || '' };
    if (policy.enabled) await createWorker();
    return this.status();
  },
  status() {
    return {
      ready: Boolean(manifest && filterSnapshotBinary),
      enabled: policy.enabled,
      filtersUpdatedAt: manifest?.fetchedAt ?? null,
      filterRules: manifest ? manifest.networkRules + manifest.cosmeticRules : 0,
      matcherTimeouts: timeoutCount,
      matcherQueueOverflows: queueOverflowCount,
    };
  },
};
