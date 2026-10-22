import { applyPatch, hashBlob, PatchError, RELEASE, checkCancel } from './patch-core.js';

const OUTPUT_NAME='Kaidou - Touge no Densetsu (Japan) [汉化优化版 1.4.1].iso';
let controller=null,busy=false,temporary=null,ownedOutput=null,outputClosed=false;
const progress=p=>postMessage({type:'progress',...p});
async function removeTemporary() {
  if(temporary) {const {directory,name}=temporary;await directory.removeEntry(name);temporary=null;postMessage({type:'temporary-cleared',name});}
}
async function removeFailedOutput() {
  if(!ownedOutput||!outputClosed) return false;
  // This handle was verified empty before we began. Never open the input for writing.
  try {if(typeof ownedOutput.remove==='function') {await ownedOutput.remove();return false;}}catch {/* older browser */}
  try {const empty=await ownedOutput.createWritable();await empty.truncate(0);await empty.close();}catch {return true;}
  return true; // an empty selected file remains for the user to remove
}
async function fetchPatch(url,signal) {
  progress({phase:'download_patch',done:0,total:RELEASE.patchSize,message:'下载约 10 MB 的补丁（不会上传 ISO）'});
  const response=await fetch(url,{signal,cache:'no-cache',credentials:'same-origin'});
  if(!response.ok||!response.body) throw new PatchError('PATCH_DOWNLOAD','补丁下载失败，请检查网络后重试。');
  // The only complete Blob is the ~10 MB patch. ISO data is never assembled in memory.
  const reader=response.body.getReader(),parts=[];let size=0;
  try {
    while(true) {
      checkCancel(signal);const {value,done}=await reader.read();if(done) break;
      size+=value.length;
      if(size>RELEASE.patchSize) throw new PatchError('PATCH_SIZE','服务器返回了错误的补丁长度。');
      parts.push(value);progress({phase:'download_patch',done:size,total:RELEASE.patchSize,message:'下载补丁，原版 ISO 保留在本机'});
    }
  }finally {await reader.cancel().catch(()=>{});}
  if(size!==RELEASE.patchSize) throw new PatchError('PATCH_SIZE','补丁下载不完整。');
  return new Blob(parts);
}
async function createSink(outputHandle,signal) {
  checkCancel(signal);
  if(outputHandle) {
    if(typeof outputHandle.createWritable!=='function') throw new PatchError('UNSUPPORTED_STORAGE','此浏览器无法直接写入文件，请使用本地临时存储模式。');
    const existing=await outputHandle.getFile();
    if(existing.size!==0) throw new PatchError('OUTPUT_EXISTS','输出位置已有非空文件。请选择新的文件名，不能覆盖原版 ISO 或已有镜像。');
    ownedOutput=outputHandle;
    const writable=await outputHandle.createWritable({keepExistingData:false});
    return {mode:'direct',handle:outputHandle,sink:{write:bytes=>writable.write(bytes),close:async()=>{await writable.close();outputClosed=true;},abort:error=>writable.abort(error)}};
  }
  if(!navigator.storage?.getDirectory) throw new PatchError('UNSUPPORTED_STORAGE','此浏览器没有本地文件流式存储能力。请使用新版 Chrome / Edge / Firefox / Safari，或电脑安装器。');
  if(!navigator.storage.estimate) throw new PatchError('UNSUPPORTED_STORAGE','浏览器无法检查临时存储空间，请使用支持本地文件保存的浏览器。');
  const estimate=await navigator.storage.estimate();
  const available=(estimate.quota||0)-(estimate.usage||0),required=RELEASE.outputSize+64*1024*1024;
  if(available<required) throw new PatchError('QUOTA_LOW',`浏览器临时存储配额不足：至少需要约 ${(required/1024**3).toFixed(2)} GiB。请释放空间、退出无痕模式，或换用可直接保存文件的浏览器。`);
  progress({phase:'prepare_output',done:0,total:RELEASE.outputSize,message:'在浏览器本地临时空间创建输出；下载时还需再留一份镜像的空间'});
  const directory=await navigator.storage.getDirectory(),name=`kaido-output-${crypto.randomUUID()}.partial`;
  const handle=await directory.getFileHandle(name,{create:true});temporary={directory,name};
  postMessage({type:'temporary',name}); // page may remember this ID to clean up after a browser crash
  if(typeof handle.createSyncAccessHandle==='function') {
    const access=await handle.createSyncAccessHandle();let position=0,closed=false;
    return {mode:'opfs',handle,sink:{
      write:async bytes=>{let n=0;while(n<bytes.length){checkCancel(signal);const written=access.write(bytes.subarray(n),{at:position+n});if(written<=0) throw new Error('临时文件写入不完整');n+=written;}position+=n;},
      close:async()=>{access.flush();access.close();closed=true;},abort:async()=>{if(!closed){access.close();closed=true;}},
    }};
  }
  if(typeof handle.createWritable==='function') {
    const writable=await handle.createWritable();
    return {mode:'opfs',handle,sink:{write:bytes=>writable.write(bytes),close:()=>writable.close(),abort:error=>writable.abort(error)}};
  }
  throw new PatchError('UNSUPPORTED_STORAGE','此浏览器无法流式写入临时文件，请更新浏览器或使用电脑安装器。');
}
self.onmessage=async ({data})=>{
  if(data?.type==='cancel') {controller?.abort();return;}
  if(data?.type==='cleanup-stale') {
    if(busy) return;
    if(typeof data.name!=='string'||!/^kaido-output-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.partial$/.test(data.name)) {
      postMessage({type:'cleanup-error',message:'临时文件标识无效。'});return;
    }
    try {
      const directory=await navigator.storage.getDirectory();
      try {await directory.removeEntry(data.name);}catch(error) {if(error.name!=='NotFoundError')throw error;}
      if(temporary?.name===data.name) temporary=null;
      postMessage({type:'temporary-cleared',name:data.name});postMessage({type:'cleaned'});
    }catch {postMessage({type:'cleanup-error',message:'临时文件尚未清理，请关闭其他正在制作镜像的标签页后重试。'});}
    return;
  }
  if(data?.type==='cleanup') {
    if(busy) return;
    try {await removeTemporary();postMessage({type:'cleaned'});}catch {postMessage({type:'cleanup-error',message:'临时文件尚未清理，请点击清理重试。'});}
    return;
  }
  if(data?.type!=='start'||busy) return;
  if(temporary) {postMessage({type:'error',code:'CLEANUP_REQUIRED',message:'请先保存或清理上一次生成的临时镜像。'});return;}
  busy=true;controller=new AbortController();ownedOutput=null;outputClosed=false;
  try {
    if(!(data.input instanceof Blob)||data.input.size!==RELEASE.inputSize) throw new PatchError('INPUT_SIZE','请选择未修改的日版原版 SLPM-66022 ISO（4,621,631,488 字节）。');
    if(typeof data.input.name==='string'&&!/\.iso$/i.test(data.input.name)) throw new PatchError('INPUT_TYPE','请选择 .iso 格式的日版原版镜像。');
    if(data.expected&&Object.entries(RELEASE).some(([k,v])=>data.expected[k]!==v)) throw new PatchError('PATCH_RELEASE','网页与补丁版本不一致，请刷新页面。');
    if(typeof DecompressionStream==='undefined') throw new PatchError('UNSUPPORTED_DEFLATE','此浏览器不支持流式解压，请更新浏览器。');
    const patch=await fetchPatch(data.patchUrl||new URL('../assets/kaido-1.4.1.kpatch',import.meta.url),controller.signal);
    const destination=await createSink(data.outputHandle,controller.signal);
    const result=await applyPatch({input:data.input,patch,sink:destination.sink,onProgress:progress,signal:controller.signal});
    const file=await destination.handle.getFile();
    const digest=await hashBlob(file,{signal:controller.signal,onProgress:progress,phase:'verify_output',message:'重新读取并校验生成镜像'});
    if(file.size!==RELEASE.outputSize||digest!==RELEASE.outputSha256) throw new PatchError('OUTPUT_READBACK','保存后的镜像校验失败，不能使用此文件。');
    checkCancel(controller.signal);
    progress({phase:'complete',done:RELEASE.outputSize,total:RELEASE.outputSize,message:'镜像生成完成，SHA-256 校验通过'});
    postMessage({type:'complete',mode:destination.mode,filename:OUTPUT_NAME,result:{...result,outputReadbackVerified:true},...(destination.mode==='opfs'?{file}:{})});
  }catch(error) {
    let cleanupFailed=false;try {await removeTemporary();}catch {cleanupFailed=true;}
    const partialOutput=await removeFailedOutput();
    const cancelled=controller?.signal.aborted;
    const quota=error?.name==='QuotaExceededError';
    postMessage({type:'error',code:cancelled?'CANCELLED':error.code||(quota?'STORAGE_FULL':'IO_FAILED'),message:cancelled?'已取消。原版 ISO 未修改。':quota?'存储空间不足，请释放空间后重试。':error.message||String(error),partialOutput,cleanupFailed});
  }finally {busy=false;controller=null;ownedOutput=null;}
};
