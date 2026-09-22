const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  page.on('pageerror',e=>console.error('Browser:',e.message));
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'load'});
  const a=fs.readFileSync('/tmp/fairytale-clip-1.mp4').toString('base64');
  const b=fs.readFileSync('/tmp/fairytale-clip-2.mp4').toString('base64');
  const result=await page.evaluate(async ([a,b])=>{
   const src=new URL('ffmpeg/ffmpeg.js',document.baseURI).href;
   await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Cannot load local FFmpeg entrypoint'));document.head.append(s)});
   if(!window.FFmpegWASM?.FFmpeg)throw Error('FFmpeg class missing');
   const ff=new FFmpegWASM.FFmpeg();
   const base=new URL('ffmpeg/',document.baseURI);
   try {
    await ff.load({coreURL:new URL('ffmpeg-core.js',base).href,wasmURL:new URL('ffmpeg-core.wasm',base).href,classWorkerURL:new URL('worker.js',base).href});
    const decode=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
    await ff.writeFile('cut0.mp4',decode(a));
    await ff.writeFile('cut1.mp4',decode(b));
    await ff.writeFile('list.txt',new TextEncoder().encode("file 'cut0.mp4'\nfile 'cut1.mp4'"));
    const code=await ff.exec(['-f','concat','-safe','0','-i','list.txt','-c','copy','-movflags','+faststart','finished.mp4']);
    if(code!==0)throw Error('FFmpeg returned '+code);
    const out=await ff.readFile('finished.mp4');
    if(out.byteLength<1000)throw Error('Output is empty');
    return {bytes:out.byteLength,header:Array.from(out.slice(4,8)).map(x=>String.fromCharCode(x)).join('')};
   }finally{ff.terminate()}
  },[a,b]);
  if(result.header!=='ftyp')throw Error('Not an MP4: '+JSON.stringify(result));
  console.log('Browser FFmpeg 2-clip MP4 smoke test passed:',result);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
