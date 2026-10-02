import fs from 'node:fs/promises';
import path from 'node:path';

/** Load only our bundled extension, into Web sessions; never into the app UI. */
export function createAdExtensionManager({webContents,sourceDirectory,targetDirectory,getFilterService}) {
  const instances=new Map();
  const watched=new WeakSet();
  let preparing;
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
  const findBackground=(id,webSession)=>webContents.getAllWebContents().find(contents=>!contents.isDestroyed()&&contents.session===webSession&&contents.getType()==='backgroundPage'&&contents.getURL().startsWith(`chrome-extension://${id}/`));
  const load=async webSession=>{
    if(!webSession.isPersistent())throw new Error('Web ad blocking extensions require a persistent Web session.');
    if(!watched.has(webSession)){
      watched.add(webSession);
      webSession.extensions.on('extension-ready',(_event,extension)=>{
        const pending=instances.get(webSession);
        if(!pending)return;
        void pending.then(async instance=>{
          if(instance.id!==extension.id||!instance.settings||!instance.background.isDestroyed())return;
          const background=findBackground(extension.id,webSession);
          if(!background)return;
          instance.background=background;instance.hash=undefined;
          await configureInstance(instance,instance.settings);
        }).catch(error=>console.error('Could not restore the Web ad-block extension.',error));
      });
    }
    const extension=await webSession.extensions.loadExtension(await prepare());
    for(let attempt=0;attempt<200;attempt++) {
      const background=findBackground(extension.id,webSession);
      if(background&&await background.executeJavaScript('Boolean(globalThis.noteboardAdBlock)').catch(()=>false))return {id:extension.id,background,session:webSession};
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('The Web ad-block extension did not start.');
  };
  const configureInstance=async (instance,settings)=>{
    const service=await getFilterService();
    const snapshot={enabled:settings.adBlock!==false,topLevelUrl:settings.topLevelUrl||'',manifest:service.manifest};
    // Avoid sending the binary on ordinary setting changes; the extension
    // replaces its engine only after a verified filter snapshot has changed.
    if(instance.hash!==snapshot.manifest.sha256)snapshot.binary=Buffer.from(service.engine.serialize()).toString('base64');
    const status=await instance.background.executeJavaScript(`globalThis.noteboardAdBlock.configure(${JSON.stringify(snapshot)})`);
    if(!status.ready)throw new Error('Web ad-block filters were not initialized.');
    instance.hash=snapshot.manifest.sha256;instance.settings=settings;
    return instance;
  };
  return {
    async configure(webSession,settings){
      let pending=instances.get(webSession);
      if(!pending){pending=load(webSession);instances.set(webSession,pending);}
      try{return await configureInstance(await pending,settings);}
      catch(error){instances.delete(webSession);throw error;}
    },
    async status(webSession){
      const instance=await instances.get(webSession);
      if(!instance||instance.background.isDestroyed())return null;
      const value=await instance.background.executeJavaScript('globalThis.noteboardAdBlock.status()');
      return {...value,extensionId:instance.id,extensionName:'Noteboard Ad Block'};
    },
    async filterRequest(webSession,details,topLevelUrl){
      const instance=await instances.get(webSession);
      if(!instance||instance.background.isDestroyed())throw new Error('Web ad-block extension is unavailable.');
      // Electron guest views do not dispatch ordinary extension webRequest
      // events. Route those requests to the same loaded extension listener.
      const frameUrl=details.resourceType==='subFrame'?details.frame?.parent?.url:details.frame?.url;
      const request={url:details.url,type:details.resourceType==='mainFrame'?'main_frame':details.resourceType,
        requestId:String(details.id),tabId:details.webContentsId,
        initiator:details.referrer||frameUrl||topLevelUrl};
      const result=await instance.background.executeJavaScript(`globalThis.noteboardAdBlock.filterRequest(${JSON.stringify(request)})`);
      return result.redirectUrl?{redirectURL:result.redirectUrl}:{cancel:result.cancel===true};
    },
    async refresh(){
      for(const pending of instances.values()){
        const instance=await pending;
        if(!instance.background.isDestroyed())await configureInstance(instance,instance.settings);
      }
    },
  };
}
