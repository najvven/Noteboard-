import fs from 'node:fs/promises';
import path from 'node:path';

/** The real extension shares one immutable filter engine; websites keep isolated sessions. */
export function createAdExtensionManager({webContents,sourceDirectory,targetDirectory,getFilterService,getExtensionSession}) {
  const profiles=new Map(),blockedCounts=new WeakMap(),watched=new WeakSet();
  let preparing,shared;
  const prepare=()=>preparing??=(async()=>{
    await fs.mkdir(targetDirectory,{recursive:true});
    for(const name of ['manifest.json','background.js']) {
      const bytes=await fs.readFile(path.join(sourceDirectory,name));
      const destination=path.join(targetDirectory,name);
      const previous=await fs.readFile(destination).catch(()=>null);
      if(!previous?.equals(bytes))await fs.writeFile(destination,bytes);
    }
    return targetDirectory;
  })();
  const findBackground=(id,runtime)=>webContents.getAllWebContents().find(contents=>
    !contents.isDestroyed()&&contents.session===runtime&&contents.getType()==='backgroundPage'&&contents.getURL().startsWith(`chrome-extension://${id}/`));
  const configureShared=async instance=>{
    if(instance.configuring){await instance.configuring;return configureShared(instance);}
    const service=await getFilterService();
    if(instance.hash===service.manifest.sha256)return instance;
    if(instance.configuring){await instance.configuring;return configureShared(instance);}
    const snapshot={enabled:true,topLevelUrl:'',manifest:service.manifest,
      binary:Buffer.from(service.engine.serialize()).toString('base64')};
    const pending=instance.background.executeJavaScript(`globalThis.noteboardAdBlock.configure(${JSON.stringify(snapshot)})`);
    instance.configuring=pending;
    try {
      const status=await pending;
      if(!status.ready)throw new Error('Web ad-block filters were not initialized.');
      instance.hash=snapshot.manifest.sha256;
    } finally {if(instance.configuring===pending)instance.configuring=undefined;}
    return configureShared(instance);
  };
  const load=async()=>{
    const runtime=getExtensionSession();
    if(!runtime.isPersistent())throw new Error('The ad-block runtime requires a persistent session.');
    if(!watched.has(runtime)){
      watched.add(runtime);
      runtime.extensions.on('extension-ready',(_event,extension)=>{
        const pending=shared;
        if(!pending)return;
        void pending.then(async instance=>{
          if(instance.id!==extension.id||!instance.background.isDestroyed())return;
          const background=findBackground(extension.id,runtime);
          if(!background)return;
          instance.background=background;instance.hash=undefined;
          await configureShared(instance);
        }).catch(error=>console.error('Could not restore the Web ad-block extension.',error));
      });
    }
    const extension=await runtime.extensions.loadExtension(await prepare());
    for(let attempt=0;attempt<200;attempt++){
      const background=findBackground(extension.id,runtime);
      if(background&&await background.executeJavaScript('Boolean(globalThis.noteboardAdBlock)').catch(()=>false))return {id:extension.id,background,session:runtime};
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('The Web ad-block extension did not start.');
  };
  const ensure=()=>shared??=load().catch(error=>{shared=undefined;throw error;});
  const hasLivePage=webSession=>webContents.getAllWebContents().some(contents=>
    !contents.isDestroyed()&&contents.session===webSession&&contents.getType()!=='backgroundPage');
  return {
    async configure(webSession,settings){
      const profile=profiles.get(webSession)??{pending:0};
      profiles.set(webSession,profile);profile.settings=settings;profile.pending++;profile.lastUse=Date.now();
      try {if(settings.adBlock!==false)await configureShared(await ensure());}
      finally {profile.pending--;profile.lastUse=Date.now();}
    },
    async status(webSession){
      const profile=profiles.get(webSession);
      const instance=shared?await shared:null;
      if(!profile||!instance||instance.background.isDestroyed())return null;
      const value=await instance.background.executeJavaScript('globalThis.noteboardAdBlock.status()');
      return {...value,ads:blockedCounts.get(webSession)??0,enabled:profile.settings.adBlock!==false,extensionId:instance.id,extensionName:'Noteboard Ad Block'};
    },
    async filterRequest(webSession,details,topLevelUrl){
      const profile=profiles.get(webSession);
      if(!profile)throw new Error('The Web session has not configured ad blocking.');
      if(profile.settings.adBlock===false)return {cancel:false};
      const instance=await configureShared(await ensure());
      if(instance.background.isDestroyed())throw new Error('Web ad-block extension is unavailable.');
      const frameUrl=details.resourceType==='subFrame'?details.frame?.parent?.url:details.frame?.url;
      const request={url:details.url,type:details.resourceType==='mainFrame'?'main_frame':details.resourceType,
        requestId:String(details.id),tabId:details.webContentsId,
        initiator:details.referrer||frameUrl||topLevelUrl||profile.settings.topLevelUrl};
      const result=await instance.background.executeJavaScript(`globalThis.noteboardAdBlock.filterRequest(${JSON.stringify(request)})`);
      if(result.redirectUrl||result.cancel===true)blockedCounts.set(webSession,(blockedCounts.get(webSession)??0)+1);
      return result.redirectUrl?{redirectURL:result.redirectUrl}:{cancel:result.cancel===true};
    },
    async refresh(){if(shared)await configureShared(await shared);},
    async releaseIdleSessions(idleFor=30000){
      for(const [webSession,profile] of profiles){
        if(!profile.pending&&Date.now()-profile.lastUse>=idleFor&&!hasLivePage(webSession))profiles.delete(webSession);
      }
      if([...profiles.values()].some(profile=>profile.pending||profile.settings.adBlock!==false)||!shared)return;
      const pending=shared,instance=await pending;
      // Configuration can begin while the loaded instance is being awaited.
      if([...profiles.values()].some(profile=>profile.pending||profile.settings.adBlock!==false)||shared!==pending||instance.configuring)return;
      instance.session.extensions.removeExtension(instance.id);
      shared=undefined;
    },
  };
}
