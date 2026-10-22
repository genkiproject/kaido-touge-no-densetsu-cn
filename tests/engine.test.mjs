import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {openAsBlob} from 'node:fs';
import {open} from 'node:fs/promises';
import {SHA256} from '../js/sha256.js';
import {applyPatch,safeUint64,PatchError,CHUNK,RELEASE} from '../js/patch-core.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const copy=(offset,n)=>Buffer.concat([Buffer.from('C'),u64(offset),u64(n)]);
const literal=bytes=>Buffer.concat([Buffer.from('L'),u64(bytes.length),bytes]);
const zero=n=>Buffer.concat([Buffer.from('Z'),u64(n)]);
function fixture({input=Buffer.from('Original Japanese image.'),ops,output,stats,tail=Buffer.alloc(0),compressedTail=Buffer.alloc(0),metadata={}}={}) {
  ops??=Buffer.concat([copy(9,8),literal(Buffer.from('汉化')),zero(5),copy(0,9)]);
  output??=Buffer.concat([input.subarray(9,17),Buffer.from('汉化'),Buffer.alloc(5),input.subarray(0,9)]);
  stats??={operations:{C:2,L:1,Z:1},operation_bytes:{C:17,L:6,Z:5}};
  const payload=Buffer.concat([deflateSync(Buffer.concat([ops,Buffer.from('E'),tail])),compressedTail]);
  const manifest={format:1,codec:'zlib-copy-literal-zero-v1',version:'fixture',input:{size:input.length,sha256:digest(input)},output:{size:output.length,sha256:digest(output)},payload_size:payload.length,payload_sha256:digest(payload),...stats,...metadata};
  const json=Buffer.from(JSON.stringify(manifest)),length=Buffer.alloc(4);length.writeUInt32LE(json.length);
  const bytes=Buffer.concat([Buffer.from('KAIDOPATCH1\n'),length,json,payload]);
  const expected={patchSize:bytes.length,patchSha256:digest(bytes),inputSize:manifest.input.size,inputSha256:manifest.input.sha256,outputSize:manifest.output.size,outputSha256:manifest.output.sha256,payloadSize:manifest.payload_size,payloadSha256:manifest.payload_sha256,version:manifest.version};
  return {input:new Blob([input]),patch:new Blob([bytes]),expected,output,bytes};
}
function sink() {
  return {chunks:[],closed:false,aborted:false,max:0,async write(b){this.max=Math.max(this.max,b.length);this.chunks.push(Buffer.from(b));},async close(){this.closed=true;},async abort(){this.aborted=true;}};
}
async function rejectCode(f,code) {
  const out=sink();await assert.rejects(()=>applyPatch({...f,sink:out}),error=>error instanceof PatchError&&error.code===code);assert.equal(out.closed,false);assert.equal(out.aborted,true);return out;
}
test('incremental SHA-256 NIST known vectors and all block-boundary splits',()=>{
  for(const text of ['', 'abc','abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq']) {
    const b=Buffer.from(text);assert.equal(new SHA256().update(b).hex(),digest(b));
  }
  const b=randomBytes(8193);
  for(const n of [1,7,55,56,63,64,65,127,128,4096]) {const h=new SHA256();for(let p=0;p<b.length;p+=n)h.update(b.subarray(p,p+n));assert.equal(h.hex(),digest(b));assert.equal(h.hex(),digest(b));assert.throws(()=>h.update(b));}
});
test('SHA-256 64-bit bit count crosses 512 MiB boundary without concatenating',()=>{
  const block=Buffer.alloc(1024*1024,0xa5),h=new SHA256(),native=createHash('sha256');
  for(let i=0;i<513;i++){h.update(block);native.update(block);}assert.equal(h.hex(),native.digest('hex'));
});
test('COPY / LITERAL / ZERO output exact, original immutable, bounded writes and progress',async()=>{
  const f=fixture(),before=await f.input.arrayBuffer(),out=sink(),phases=new Set();
  const result=await applyPatch({...f,sink:out,onProgress:p=>phases.add(p.phase)});
  assert.deepEqual(Buffer.concat(out.chunks),f.output);assert.equal(result.outputSha256,digest(f.output));assert.equal(out.closed,true);assert.ok(out.max<=CHUNK);assert.deepEqual(await f.input.arrayBuffer(),before);assert.deepEqual([...phases],['validate_patch','validate_input','apply']);
});
test('64-bit COPY address decoder preserves addresses above 4 GiB',()=>{
  for(const offset of [2**32+23,2**32-1,2**40+987,Number.MAX_SAFE_INTEGER]) {
    const large=u64(offset);assert.equal(safeUint64(new DataView(large.buffer,large.byteOffset,8)),offset);
  }
});
test('bad patch hash and wrong original fail before any output write',async()=>{
  const f=fixture();const out=await rejectCode({...f,expected:{...f.expected,patchSha256:'0'.repeat(64)}},'PATCH_HASH');assert.equal(out.chunks.length,0);
  const wrong=await rejectCode({...f,input:new Blob([Buffer.alloc(f.input.size)])},'INPUT_HASH');assert.equal(wrong.chunks.length,0);
  await rejectCode({...f,input:new Blob(['too short'])},'INPUT_SIZE');
});
test('payload hash, pinned metadata and trailing file data rejected',async()=>{
  const f=fixture();await rejectCode({...f,expected:{...f.expected,payloadSha256:'0'.repeat(64)}},'PATCH_RELEASE');
  await rejectCode({...f,expected:{...f.expected,version:'other'}},'PATCH_RELEASE');
  const bytes=Buffer.concat([f.bytes,Buffer.from([0])]);await rejectCode({...f,patch:new Blob([bytes]),expected:{...f.expected,patchSize:bytes.length,patchSha256:digest(bytes)}},'PATCH_TRAILING');
});
test('compressed / decompressed trailing bytes and truncated streams rejected',async()=>{
  await rejectCode(fixture({tail:Buffer.from('trailing instruction')}),'PATCH_TRAILING');
  await rejectCode(fixture({compressedTail:Buffer.from('extra compressed data')}),'PATCH_DEFLATE');
  const f=fixture(),bytes=f.bytes.subarray(0,f.bytes.length-2);
  await rejectCode({...f,patch:new Blob([bytes]),expected:{...f.expected,patchSize:bytes.length,patchSha256:digest(bytes)}},'PATCH_TRAILING');
});
test('bad opcode, out-of-range/zero/unsafe COPY and overflow output rejected',async()=>{
  await rejectCode(fixture({ops:Buffer.from('X')}),'PATCH_OPCODE');
  await rejectCode(fixture({ops:copy(100,1)}),'PATCH_BOUNDS');
  await rejectCode(fixture({ops:copy(0,0)}),'PATCH_BOUNDS');
  await rejectCode(fixture({ops:copy(0,29)}),'PATCH_BOUNDS');
  await rejectCode(fixture({ops:copy(2n**63n,1)}),'UNSAFE_INTEGER');
});
test('END before expected output and false operation statistics rejected',async()=>{
  await rejectCode(fixture({ops:Buffer.alloc(0)}),'OUTPUT_SIZE');
  const f=fixture({stats:{operations:{C:3,L:1,Z:1},operation_bytes:{C:17,L:6,Z:5}}});await rejectCode(f,'PATCH_STATISTICS');
});
test('computed output hash mismatch aborts sink before close',async()=>{
  const f=fixture({metadata:{output:{size:28,sha256:'0'.repeat(64)}}});await rejectCode(f,'OUTPUT_HASH');
});
test('large COPY is split into <=4 MiB writes, mixed literal split safe',async()=>{
  const input=randomBytes(CHUNK+79),lit=randomBytes(131073),output=Buffer.concat([input,lit,Buffer.alloc(33)]);
  const f=fixture({input,output,ops:Buffer.concat([copy(0,input.length),literal(lit),zero(33)]),stats:{operations:{C:1,L:1,Z:1},operation_bytes:{C:input.length,L:lit.length,Z:33}}});
  const out=sink();await applyPatch({...f,sink:out});assert.deepEqual(Buffer.concat(out.chunks),output);assert.equal(out.max,CHUNK);
});
test('cancellation during hashing or writing aborts and never closes output',async()=>{
  for(const target of ['validate_input','apply']) {
    const controller=new AbortController(),out=sink(),f=fixture();
    await assert.rejects(()=>applyPatch({...f,sink:out,signal:controller.signal,onProgress:p=>{if(p.phase===target&&p.done>0)controller.abort();}}),e=>e.code==='CANCELLED');
    assert.equal(out.aborted,true);assert.equal(out.closed,false);
  }
});
test('write / storage errors abort sink and report actionable error code',async()=>{
  const out=sink();out.write=async()=>{throw new DOMException('full','QuotaExceededError');};
  await assert.rejects(()=>applyPatch({...fixture(),sink:out}),e=>e.code==='STORAGE_FULL');assert.equal(out.aborted,true);assert.equal(out.closed,false);
});
test('worker guards original output, insufficient quota, owned temp cleanup and exact stale cleanup',async()=>{
  const originalFetch=globalThis.fetch,originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const messages=[],removed=[];globalThis.self={};globalThis.postMessage=m=>messages.push(m);
  let downloads=0,opened=0,aborted=false;
  globalThis.fetch=async()=>{downloads++;return {ok:true,body:new Blob([new Uint8Array(RELEASE.patchSize)]).stream()};};
  const directory={async removeEntry(name){removed.push(name);},async getFileHandle(){return {async createWritable(){return {async abort(){aborted=true;},async close(){},async write(){}};}};}};
  const nav={storage:{async getDirectory(){opened++;return directory;},async estimate(){return {quota:RELEASE.outputSize+1024**3,usage:0};}}};
  Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true});
  class LargeInput extends Blob {get size(){return RELEASE.inputSize;}get name(){return 'original.iso';}}
  try {
    await import('../js/patch-worker.js');
    let writableOpened=false;
    await self.onmessage({data:{type:'start',input:new LargeInput(),outputHandle:{async getFile(){return {size:RELEASE.inputSize};},async createWritable(){writableOpened=true;}}}});
    assert.equal(messages.at(-1).code,'OUTPUT_EXISTS');assert.equal(writableOpened,false);assert.equal(opened,0);
    nav.storage.estimate=async()=>({quota:1024,usage:0});
    await self.onmessage({data:{type:'start',input:new LargeInput()}});
    assert.equal(messages.at(-1).code,'QUOTA_LOW');assert.equal(opened,0);
    nav.storage.estimate=async()=>({quota:RELEASE.outputSize+1024**3,usage:0});
    await self.onmessage({data:{type:'start',input:new LargeInput()}});
    assert.equal(messages.at(-1).code,'PATCH_FORMAT');assert.equal(aborted,true);assert.equal(removed.length,1);
    const temporary=messages.find(m=>m.type==='temporary');assert.equal(removed[0],temporary.name);assert.ok(messages.some(m=>m.type==='temporary-cleared'&&m.name===temporary.name));
    const before=opened;
    await self.onmessage({data:{type:'cleanup-stale',name:'../original.iso'}});
    assert.equal(messages.at(-1).type,'cleanup-error');assert.equal(opened,before);
    const stale='kaido-output-12345678-1234-1234-1234-123456789abc.partial';
    await self.onmessage({data:{type:'cleanup-stale',name:stale}});
    assert.equal(removed.at(-1),stale);assert.equal(messages.at(-1).type,'cleaned');assert.equal(downloads,3);
  }finally {
    globalThis.fetch=originalFetch;delete globalThis.self;delete globalThis.postMessage;
    if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;
  }
});
// Optional maintenance regression. It reads the real ISO locally and discards output;
// no image is created and no part of the ISO is sent to a server.
test('real Japanese ISO produces exact published 1.4.1 SHA-256 (optional, no output file)',{skip:!process.env.KAIDO_TEST_ORIGINAL_ISO},async t=>{
  const handle=await open(process.env.KAIDO_TEST_ORIGINAL_ISO,'r'),before=await handle.stat();
  try {
    // Node 24 on Windows openAsBlob wraps >4 GiB file sizes. Avoid it for the ISO.
    // Only this bounded read adapter is Node-specific; browsers pass an ordinary File.
    const input={size:before.size,slice(start,end){return {async arrayBuffer(){
      assert.ok(end-start<=CHUNK);const bytes=Buffer.alloc(end-start);let filled=0;
      while(filled<bytes.length) {const read=await handle.read(bytes,filled,bytes.length-filled,start+filled);if(!read.bytesRead)throw new Error('Unexpected ISO EOF');filled+=read.bytesRead;}
      return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    }}}};
    const patch=await openAsBlob(new URL('../assets/kaido-1.4.1.kpatch',import.meta.url));
    let produced=0,maxWrite=0,closed=false;
    const result=await applyPatch({input,patch,sink:{async write(bytes){produced+=bytes.length;maxWrite=Math.max(maxWrite,bytes.length);},async close(){closed=true;},async abort(){}}});
    assert.equal(closed,true);assert.equal(produced,RELEASE.outputSize);assert.equal(result.outputSha256,RELEASE.outputSha256);assert.ok(maxWrite<=CHUNK);
    const after=await handle.stat();assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
    t.diagnostic(JSON.stringify({...result,maxWrite,mode:'real ISO / discard output / no image created'}));
  }finally {await handle.close();}
});
