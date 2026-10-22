import { SHA256 } from './sha256.js';

export const CHUNK = 4 * 1024 * 1024;
const MAGIC = new TextEncoder().encode('KAIDOPATCH1\n');
const DIGEST = /^[0-9a-f]{64}$/;
export const RELEASE = Object.freeze({
  patchSize:10052639, patchSha256:'21890c86ccdbbfdc3e686ce5e4988314b4d83407c425e178b1bb37edc4c4791a',
  inputSize:4621631488, inputSha256:'db026968bfc55da9730a1e179f89ecda75a23b12c040a6f6dc1375381b1e4115',
  outputSize:4636448768, outputSha256:'2b9b47c2b97229b0556f7b0cac22c678d9aa3a5b48df452ef22102d0cf3ae8b9',
  payloadSize:10051979, payloadSha256:'9fb33e2b6cb96fd607035cf22613e6e7b0e7012cd148ce59f401ece2cbd6da95',
  version:'2026.10.22-grip-balance-v1',
});
export class PatchError extends Error {
  constructor(code,message) {super(message);this.name='PatchError';this.code=code;}
}
const fail=(code,message)=>{throw new PatchError(code,message);};
export const checkCancel=signal=>{if(signal?.aborted) fail('CANCELLED','已取消，原版镜像未修改。');};
const emit=(fn,phase,done,total,message)=>fn?.({phase,done,total,message});
const sizeOK=n=>Number.isSafeInteger(n)&&n>0&&n<64*1024**3;
export function safeUint64(view,offset=0) {
  const n=view.getBigUint64(offset,true);
  if(n>BigInt(Number.MAX_SAFE_INTEGER)) fail('UNSAFE_INTEGER','补丁包含不安全的 64 位地址。');
  return Number(n);
}
export async function hashBlob(blob,{signal,onProgress,phase='validate_input',message='校验原版镜像'}={}) {
  const hash=new SHA256();
  emit(onProgress,phase,0,blob.size,message);
  for(let p=0;p<blob.size;p+=CHUNK) {
    checkCancel(signal);
    const bytes=new Uint8Array(await blob.slice(p,Math.min(p+CHUNK,blob.size)).arrayBuffer());
    if(bytes.length!==Math.min(CHUNK,blob.size-p)) fail('READ_FAILED','文件读取不完整。');
    hash.update(bytes);emit(onProgress,phase,p+bytes.length,blob.size,message);
  }
  checkCancel(signal);
  return hash.hex();
}
export async function readManifest(patch,expected=RELEASE) {
  if(patch.size!==expected.patchSize) fail('PATCH_SIZE','补丁长度错误，请刷新网页重新下载补丁。');
  const header=new Uint8Array(await patch.slice(0,MAGIC.length+4).arrayBuffer());
  if(header.length!==MAGIC.length+4||!MAGIC.every((v,i)=>header[i]===v)) fail('PATCH_FORMAT','补丁文件格式错误。');
  const length=new DataView(header.buffer,header.byteOffset+MAGIC.length,4).getUint32(0,true);
  if(!length||length>256*1024) fail('PATCH_METADATA','补丁信息长度错误。');
  const bodyOffset=MAGIC.length+4+length;
  if(bodyOffset>patch.size) fail('PATCH_TRUNCATED','补丁信息不完整。');
  let m;
  try {m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await patch.slice(MAGIC.length+4,bodyOffset).arrayBuffer()));}
  catch {fail('PATCH_METADATA','补丁信息不是有效的 UTF-8 JSON。');}
  if(m?.format!==1||m?.codec!=='zlib-copy-literal-zero-v1') fail('PATCH_FORMAT','不支持此补丁格式。');
  for(const key of ['input','output']) {
    if(!sizeOK(m[key]?.size)||!DIGEST.test(m[key]?.sha256)) fail('PATCH_METADATA','补丁镜像长度或校验信息错误。');
  }
  if(!Number.isSafeInteger(m.payload_size)||m.payload_size<=0||m.payload_size>512*1024**2||!DIGEST.test(m.payload_sha256)) fail('PATCH_METADATA','补丁数据长度或校验信息错误。');
  if(bodyOffset+m.payload_size!==patch.size) fail('PATCH_TRAILING','补丁长度不符，可能不完整或包含额外数据。');
  const actual={inputSize:m.input.size,inputSha256:m.input.sha256,outputSize:m.output.size,outputSha256:m.output.sha256,payloadSize:m.payload_size,payloadSha256:m.payload_sha256,version:m.version};
  for(const [key,value] of Object.entries(actual)) if(value!==expected[key]) fail('PATCH_RELEASE','补丁不属于此网页发布的版本。');
  for(const key of ['operations','operation_bytes']) {
    if(!m[key]||['C','L','Z'].some(op=>!Number.isSafeInteger(m[key][op])||m[key][op]<0)) fail('PATCH_METADATA','补丁指令统计信息错误。');
  }
  return {manifest:m,bodyOffset};
}

// Holds one decompressor chunk and at most the caller's requested bytes.
class OperationReader {
  constructor(stream,signal) {this.reader=stream.getReader();this.signal=signal;this.chunk=null;this.position=0;this.eof=false;}
  async take() {
    checkCancel(this.signal);
    let item;
    try {item=await this.reader.read();} catch {checkCancel(this.signal);fail('PATCH_DEFLATE','补丁压缩数据损坏或包含多余压缩数据。');}
    if(item.done) {this.eof=true;this.chunk=null;return false;}
    if(!(item.value instanceof Uint8Array)||item.value.length>CHUNK) fail('PATCH_DEFLATE','补丁解压块超出安全上限。');
    this.chunk=item.value;this.position=0;return true;
  }
  async read(count) {
    if(!Number.isSafeInteger(count)||count<=0||count>CHUNK) fail('INTERNAL_LIMIT','指令读取超出安全上限。');
    const out=new Uint8Array(count);let filled=0;
    while(filled<count) {
      if(!this.chunk||this.position===this.chunk.length) {if(!await this.take()) fail('PATCH_TRUNCATED','补丁指令提前结束。');}
      const n=Math.min(count-filled,this.chunk.length-this.position);
      out.set(this.chunk.subarray(this.position,this.position+n),filled);filled+=n;this.position+=n;
    }
    return out;
  }
  async finish() {
    if(this.chunk&&this.position<this.chunk.length) fail('PATCH_TRAILING','补丁结束指令之后仍有数据。');
    while(!this.eof) {if(await this.take()&&this.chunk.length) fail('PATCH_TRAILING','补丁结束指令之后仍有数据。');}
  }
  async cancel() {try {await this.reader.cancel();}catch {/* decompression error already reported */}}
}

/** Only slice-readable Blobs and a bounded writable sink are used; input is never opened for writing. */
export async function applyPatch({input,patch,sink,expected=RELEASE,onProgress,signal}) {
  let reader;
  try {
    checkCancel(signal);
    if(typeof DecompressionStream==='undefined') fail('UNSUPPORTED_DEFLATE','此浏览器不支持流式解压，请更新浏览器。');
    const {manifest:m,bodyOffset}=await readManifest(patch,expected);
    if(input.size!==m.input.size) fail('INPUT_SIZE','请选择未修改的日版原版 SLPM-66022 ISO；文件大小不符。');
    const patchHash=await hashBlob(patch,{signal,onProgress,phase:'validate_patch',message:'校验补丁文件'});
    if(patchHash!==expected.patchSha256) fail('PATCH_HASH','补丁文件校验失败，请刷新网页重新下载。');
    const payloadHash=await hashBlob(patch.slice(bodyOffset),{signal,onProgress,phase:'validate_patch',message:'校验补丁数据'});
    if(payloadHash!==m.payload_sha256) fail('PAYLOAD_HASH','补丁数据校验失败。');
    const inputHash=await hashBlob(input,{signal,onProgress});
    if(inputHash!==m.input.sha256) fail('INPUT_HASH','镜像校验不符：需要未经修改的日版 SLPM-66022 原版 ISO。已打补丁的镜像不能重复使用。');
    checkCancel(signal);
    let stream;
    try {stream=patch.slice(bodyOffset).stream().pipeThrough(new DecompressionStream('deflate'));}
    catch {fail('UNSUPPORTED_DEFLATE','此浏览器不支持所需的 zlib 流式解压。');}
    reader=new OperationReader(stream,signal);
    const hash=new SHA256(),zero=new Uint8Array(CHUNK),counts={C:0,L:0,Z:0},opBytes={C:0,L:0,Z:0};
    let produced=0;
    emit(onProgress,'apply',0,m.output.size,'正在生成汉化优化版');
    while(true) {
      checkCancel(signal);
      const op=String.fromCharCode((await reader.read(1))[0]);
      if(op==='E') break;
      if(!['C','L','Z'].includes(op)) fail('PATCH_OPCODE','补丁包含未知指令。');
      const args=await reader.read(op==='C'?16:8),view=new DataView(args.buffer,args.byteOffset,args.byteLength);
      const offset=op==='C'?safeUint64(view,0):0,length=safeUint64(view,op==='C'?8:0);
      if(!length||length>m.output.size-produced) fail('PATCH_BOUNDS','补丁指令超出输出镜像范围。');
      if(op==='C'&&(offset>input.size||length>input.size-offset)) fail('PATCH_BOUNDS','补丁读取超出原版镜像范围。');
      counts[op]++;opBytes[op]+=length;
      for(let p=0;p<length;) {
        checkCancel(signal);
        const count=Math.min(op==='L'?65536:CHUNK,length-p);
        const bytes=op==='C'?new Uint8Array(await input.slice(offset+p,offset+p+count).arrayBuffer()):op==='L'?await reader.read(count):zero.subarray(0,count);
        if(bytes.length!==count) fail('READ_FAILED','原版镜像读取不完整。');
        hash.update(bytes);await sink.write(bytes);p+=count;produced+=count;
        emit(onProgress,'apply',produced,m.output.size,'正在生成汉化优化版');
      }
    }
    await reader.finish();
    if(produced!==m.output.size) fail('OUTPUT_SIZE','补丁输出长度错误。');
    for(const op of ['C','L','Z']) if(counts[op]!==m.operations[op]||opBytes[op]!==m.operation_bytes[op]) fail('PATCH_STATISTICS','补丁指令统计信息不符。');
    const outputHash=hash.hex();
    if(outputHash!==m.output.sha256) fail('OUTPUT_HASH','生成镜像校验失败，临时输出将撤销。');
    checkCancel(signal);await sink.close();
    return {inputSha256:inputHash,outputSha256:outputHash,outputSize:produced,patchVersion:m.version,copiedOriginalBytes:opBytes.C,literalPatchBytes:opBytes.L,originalUnchanged:true};
  } catch(error) {
    await reader?.cancel();
    try {await sink.abort?.(error);}catch {/* worker performs owned-file cleanup */}
    if(error instanceof PatchError) throw error;
    if(signal?.aborted) fail('CANCELLED','已取消，原版镜像未修改。');
    throw new PatchError(error?.name==='QuotaExceededError'?'STORAGE_FULL':'IO_FAILED',error?.name==='QuotaExceededError'?'存储空间不足，请释放空间后重试。':'文件读写失败：'+(error?.message||String(error)));
  }
}
