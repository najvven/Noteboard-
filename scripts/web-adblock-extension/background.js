import { FiltersEngine, Request } from '@ghostery/adblocker';

let engine;
let policy={enabled:false,topLevelUrl:''};
let manifest;
const pageUrls=new Map();

// This MV2 extension owns the request decisions. Chrome calls its listener for
// ordinary pages; the host forwards Electron guest-view requests to it.
function filterRequest(details) {
  if(!engine)throw new Error('Ad-block filters are not ready.');
  if(details.type==='main_frame')pageUrls.set(details.tabId,details.url);
  if(!policy.enabled||details.type==='main_frame')return {};
  const request=Request.fromRawDetails({
    url:details.url,type:details.type,requestId:details.requestId,tabId:details.tabId,
    sourceUrl:details.initiator||details.originUrl||details.documentUrl||pageUrls.get(details.tabId)||policy.topLevelUrl,
  });
  const {match,redirect}=engine.match(request);
  return redirect?{redirectUrl:redirect.dataUrl}:{cancel:match};
}
chrome.webRequest.onBeforeRequest.addListener(filterRequest,{urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},['blocking']);

globalThis.noteboardAdBlock={
  filterRequest,
  configure(next){
    if(!manifest||manifest.sha256!==next.manifest.sha256){
      engine=FiltersEngine.deserialize(Uint8Array.from(atob(next.binary),char=>char.charCodeAt(0)));
      manifest=next.manifest;
    }
    policy={enabled:next.enabled===true,topLevelUrl:next.topLevelUrl||''};
    return this.status();
  },
  status(){return {ready:Boolean(engine),enabled:policy.enabled,filtersUpdatedAt:manifest?.fetchedAt??null,filterRules:manifest?manifest.networkRules+manifest.cosmeticRules:0};},
};
