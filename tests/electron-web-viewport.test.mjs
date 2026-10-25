import assert from 'node:assert/strict';
import test from 'node:test';
import { configureWebViewport } from '../shared/electron-web-viewport.js';

function viewportGuest() {
  const commands=[];
  let attached=false, zoom=1, destroyed=false;
  const contents={
    isDestroyed:()=>destroyed,
    getZoomFactor:()=>zoom,
    setZoomFactor:value=>{zoom=value;},
    setUserAgent:value=>{contents.userAgent=value;},
    debugger:{
      isAttached:()=>attached,
      attach:()=>{attached=true;},
      sendCommand:async(method,params)=>{commands.push({method,params});},
    },
  };
  return {contents,commands,setZoom:value=>{zoom=value;},detach:()=>{attached=false;},destroy:()=>{destroyed=true;}};
}

const apply=(guest,width=390,height=700,deviceMode='phone')=>
  configureWebViewport(guest,{width,height,deviceMode},'146.0.1.0','win32');

test('a Web resize burst applies the latest metrics once and acknowledges every caller', async()=>{
  const {contents,commands}=viewportGuest();
  const originalSend=contents.debugger.sendCommand;
  let releaseIdentity;
  const identityWait=new Promise(resolve=>{releaseIdentity=resolve;});
  let identityStarted;
  const started=new Promise(resolve=>{identityStarted=resolve;});
  contents.debugger.sendCommand=async(method,params)=>{
    await originalSend(method,params);
    if(method==='Emulation.setUserAgentOverride') {identityStarted();await identityWait;}
  };
  const requests=[apply(contents)];
  await started;
  for(let index=0;index<50;index++)requests.push(apply(contents,400+index,600-index));
  releaseIdentity();
  assert.ok((await Promise.all(requests)).every(Boolean));
  const metrics=commands.filter(command=>command.method==='Emulation.setDeviceMetricsOverride');
  assert.equal(metrics.length,1,'Superseded sizes must not queue redundant Chromium layout work.');
  assert.equal(metrics[0].params.width,449);
  assert.equal(metrics[0].params.height,551);
  const count=commands.length;
  await Promise.all(Array.from({length:20},()=>apply(contents,449,551)));
  assert.equal(commands.length,count,'An unchanged viewport must not reapply emulation.');
});

test('Web viewport updates preserve mode identity, reset zoom and recover after detach or failure', async()=>{
  const {contents,commands,setZoom,detach,destroy}=viewportGuest();
  assert.equal(await apply(contents),true);
  setZoom(1.5);
  await apply(contents);
  assert.equal(contents.getZoomFactor(),1);
  await apply(contents,1000,600,'desktop');
  const count=commands.length;
  await apply(contents,1200,900,'desktop');
  assert.equal(commands.length,count,'Desktop layout follows its real guest bounds without metrics overrides.');
  detach();
  await apply(contents,1200,900,'desktop');
  assert.equal(commands.filter(command=>command.method==='Emulation.clearDeviceMetricsOverride').length,2);
  const originalSend=contents.debugger.sendCommand;
  let rejectOnce=true;
  contents.debugger.sendCommand=async(method,params)=>{
    if(rejectOnce&&method==='Emulation.setDeviceMetricsOverride') {rejectOnce=false;throw new Error('Transient debugger failure');}
    return originalSend(method,params);
  };
  await assert.rejects(apply(contents,700,500,'tablet'),/Transient debugger failure/);
  assert.equal(await apply(contents,700,500,'tablet'),true);
  assert.equal(commands.at(-1).params.width,700);
  assert.match(contents.userAgent,/Android/);
  destroy();
  assert.equal(await apply(contents),false);
});
