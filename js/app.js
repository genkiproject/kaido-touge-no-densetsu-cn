import { RELEASE } from './patch-core.js';
const $=id=>document.getElementById(id),fileInput=$('iso-file'),start=$('start');
const phases={download_patch:['下载补丁',0,3],validate_patch:['校验补丁',3,2],validate_input:['校验日版原版',5,35],prepare_output:['准备保存空间',3,0],apply:['生成汉化优化版',40,40],verify_output:['校验输出文件',80,20],complete:['输出校验通过',100,0]};
const KEY='kaido-patcher-temporary-v1';let input=null,worker=null,busy=false,outputURL=null,waitingSave=false,started=0,timer=null,wake=null,pendingName='',shownPercent=0;
function readPending(){try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(KEY+':'))return k.slice(KEY.length+1);}return localStorage.getItem(KEY)||'';}catch{return '';}}
pendingName=readPending();
const direct=typeof window.showSaveFilePicker==='function';
const supported=isSecureContext&&typeof Worker==='function'&&typeof DecompressionStream==='function'&&typeof BigInt==='function'&&(direct||typeof navigator.storage?.getDirectory==='function');
const bytes=n=>`${(n/1e9).toFixed(2)} GB`;
function feedback(message,error=false){$('feedback').textContent=message;$('feedback').className=`feedback ${error?'error':'success'}`;}
function pending(name){const prior=pendingName;try{if(name)localStorage.setItem(KEY+':'+name,'1');else{if(prior)localStorage.removeItem(KEY+':'+prior);if(localStorage.getItem(KEY)===prior)localStorage.removeItem(KEY);}}catch{}pendingName=name||readPending();update();}
function update(){start.disabled=!supported||!input||busy||waitingSave||!!pendingName;fileInput.disabled=busy||waitingSave;$('select-label').style.pointerEvents=fileInput.disabled?'none':'';$('cancel').hidden=!busy;$('stale-cleanup').hidden=!pendingName||busy||waitingSave;}
function step(n,done=false){for(let i=1;i<=3;i++)$(`step-${i}`).className=i<n||(done&&i===n)?'done':i===n?'current':'';}
function select(file){
 if(busy||waitingSave)return;input=null;$('drop-zone').className='drop-zone';$('file-title').textContent=file?.name||'放入你的日版原版 ISO';
 if(!file){$('file-detail').textContent='SLPM-66022 · 约 4.62 GB · 未修改的原版';update();return;}
 if(!/\.iso$/i.test(file.name)||file.size!==RELEASE.inputSize){$('drop-zone').classList.add('invalid');$('file-detail').textContent=`已选择 ${bytes(file.size)}`;feedback('文件不是支持的日版原版 ISO。需要 4,621,631,488 字节的 .iso 文件，不能使用 CHD 或旧汉化版。',true);update();return;}
 input=file;$('drop-zone').classList.add('selected');$('file-detail').textContent=`${bytes(file.size)} · 制作前会校验完整 SHA-256`;feedback('镜像已选择。准备好空间后即可开始制作。');step(1);update();
}
fileInput.addEventListener('change',()=>select(fileInput.files[0]));const drop=$('drop-zone');
for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();if(!busy)drop.classList.add('dragging');});
for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');});
drop.addEventListener('drop',e=>{if(e.dataTransfer.files.length!==1){feedback('请一次选择一个 ISO 文件。',true);return;}select(e.dataTransfer.files[0]);});
async function keepAwake(){try{if(busy&&document.visibilityState==='visible')wake=await navigator.wakeLock?.request('screen');}catch{}}
async function idle(){busy=false;clearInterval(timer);timer=null;try{await wake?.release();}catch{}wake=null;$('cancel').disabled=false;$('cancel').textContent='取消处理';update();}
function ensureWorker(){
 if(worker)return worker;worker=new Worker(new URL('./patch-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=async({data})=>{
  if(data.type==='temporary'){pending(data.name);return;}
  if(data.type==='temporary-cleared'){if(data.name===pendingName)pending('');return;}
  if(data.type==='progress'){const [label,base,weight]=phases[data.phase]||[data.message,0,0],ratio=data.total?Math.min(1,data.done/data.total):0,percent=Math.max(shownPercent,Math.floor(base+weight*ratio));shownPercent=percent;$('phase-title').textContent=label;$('percent').textContent=`${percent}%`;$('progress').value=percent;$('progress-detail').textContent=`${data.message}${data.total?` · ${bytes(data.done)} / ${bytes(data.total)}`:''}`;return;}
  if(data.type==='complete'){
   await idle();$('progress').value=100;$('percent').textContent='100%';$('phase-title').textContent='输出完整校验通过';
   if(data.mode==='direct'){step(3,true);feedback('制作完成！已将校验通过的 ISO 保存到你选择的位置。');start.textContent='再制作一份 ↗';}
   else{waitingSave=true;step(3);outputURL=URL.createObjectURL(data.file);$('download').href=outputURL;$('download').download=data.filename;$('download-actions').hidden=false;start.hidden=true;feedback('镜像生成与校验完成。请点击下面的按钮，将文件保存到手机。');}update();return;
  }
  if(data.type==='error'){await idle();step(1);feedback(data.message+(data.partialOutput?' 输出位置可能留下空文件，请在文件管理器中检查。':''),data.code!=='CANCELLED');start.textContent='重新制作 ↗';update();return;}
  if(data.type==='cleaned'){if(outputURL){URL.revokeObjectURL(outputURL);outputURL=null;}waitingSave=false;$('download-actions').hidden=true;start.hidden=false;start.textContent='再制作一份 ↗';feedback('临时文件已清理，下载目录中的 ISO 不受影响。');step(3,true);update();return;}
  if(data.type==='cleanup-error'){feedback(data.message||'临时文件清理失败，请稍后重试。',true);update();}
 };
 worker.onerror=async()=>{await idle();worker?.terminate();worker=null;feedback('处理进程被浏览器中止。请保持网页在前台；如有临时文件，请先使用下方入口清理。',true);update();};return worker;
}
start.addEventListener('click',async()=>{
 if(!input||busy||waitingSave)return;pendingName=pendingName||readPending();if(pendingName){update();feedback('请先关闭其他补丁页面，确认下载完成后清理临时文件，再开始新任务。',true);return;}let outputHandle;
 // Show picker in the original user gesture, before network or long hashing.
 if(direct){try{outputHandle=await window.showSaveFilePicker({suggestedName:'Kaidou-CHS-1.4.1.iso',types:[{description:'PlayStation 2 镜像',accept:{'application/octet-stream':['.iso']}}]});const chosen=await outputHandle.getFile();if(chosen.size>0){feedback('该输出文件已存在。请选择新的文件名，避免覆盖原版或已有镜像。',true);return;}}catch(error){if(error.name!=='AbortError')feedback('无法选择输出位置。请在浏览器中允许保存文件，或换用新版 Chrome。',true);return;}}
 busy=true;shownPercent=0;started=performance.now();$('progress-box').hidden=false;$('progress').value=0;$('percent').textContent='0%';feedback('正在本地处理，请保持页面打开。');step(2);update();keepAwake();
 timer=setInterval(()=>{const s=Math.floor((performance.now()-started)/1000);$('elapsed').textContent=`已用时 ${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')} · 速度取决于设备性能`;},1000);
 try{ensureWorker().postMessage({type:'start',input,outputHandle});}catch{await idle();feedback('浏览器无法启动本地文件处理，请换用新版浏览器。',true);}
});
$('cancel').addEventListener('click',()=>{if(!busy)return;worker?.postMessage({type:'cancel'});$('cancel').disabled=true;$('cancel').textContent='正在取消并清理…';});
$('download').addEventListener('click',()=>feedback('已请求浏览器下载。请等下载完成，并在文件管理器检查大小后，再点击“清理临时文件”。'));
$('cleanup').addEventListener('click',()=>ensureWorker().postMessage(pendingName?{type:'cleanup-stale',name:pendingName}:{type:'cleanup'}));
$('stale-cleanup').addEventListener('click',()=>{if(pendingName&&!busy&&!waitingSave)ensureWorker().postMessage({type:'cleanup-stale',name:pendingName});});
document.addEventListener('visibilitychange',()=>{if(busy)keepAwake();});window.addEventListener('beforeunload',e=>{if(busy||waitingSave){e.preventDefault();e.returnValue='';}});
if(!supported){$('capability').textContent='当前环境无法安全处理大文件。请在 HTTPS 页面中使用支持本地存储的新版浏览器。';$('capability').classList.add('unsupported');}
else if(direct){$('capability').textContent='此浏览器支持直接保存 · 处理时会让你选择新的 ISO 输出位置';$('save-note').textContent='请为新镜像预留充足空间，保持页面在前台并避免锁屏。';}
else{$('capability').textContent='兼容模式 · 浏览器临时存储后下载，大文件导出受设备限制';$('save-note').textContent='建议在原版之外预留至少 10 GB。保持页面在前台，保存完成前不要清理临时文件。';}update();
