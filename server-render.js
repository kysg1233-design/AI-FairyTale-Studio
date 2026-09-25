'use strict';
// Server renderer: browser uploads original files directly to private R2 using
// short-lived signed URLs; the private GitHub Actions runner performs the render.
const StudioServer=(()=>{
 const base=()=>String(window.FAIRYTALE_CONFIG?.apiBase||'').replace(/\/$/,'');
 const token=()=>sessionStorage.getItem('fairytale-worker-token')||'';
 async function request(path,method='GET',data){
  const r=await fetch(base()+path,{method,headers:{'X-Studio-Token':token(),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'서버 HTTP '+r.status);return j;
 }
 async function health(){
  try{const r=await fetch(base()+'/health',{signal:AbortSignal.timeout(12000)});const j=await r.json();return r.ok&&j.ready;}
  catch{return false;}
 }
 async function ensureAccess(){
  if(!(await health()))throw Error('서버 합성이 아직 연결되지 않았습니다. 비공개 Worker/R2/GitHub Actions 설정이 필요합니다. 모바일에서 영상을 다시 만들지 마세요.');
  if(!token()){const t=prompt('비공개 스튜디오 접근키를 입력해 주세요 (Gemini API 키가 아닙니다).');if(!t)throw Error('스튜디오 접근키가 필요합니다.');sessionStorage.setItem('fairytale-worker-token',t.trim());}
 }
 const key=id=>'fairytale-server-job-'+id;
 async function poll(project,box,onProgress){
  const saved=JSON.parse(localStorage.getItem(key(project.id))||'null');if(!saved)return false;
  const j=await request('/api/jobs/'+saved.jobId);
  const percent=Math.max(0,Math.min(100,Number(j.percent)||0));
  onProgress({percent,phase:j.stage||'서버에서 합성 중',detail:j.detail||'브라우저를 닫아도 작업이 계속됩니다.'});
  box.textContent=j.stage||'서버에서 합성 중';
  if(j.status==='complete'){
   const download=await request('/api/projects/'+saved.serverId+'/download');
   const a=document.createElement('a');a.className='primary';a.textContent='완성 MP4 다운로드';a.href=download.url;a.target='_blank';a.rel='noopener';box.replaceChildren(a);
   localStorage.removeItem(key(project.id));return true;
  }
  if(j.status==='failed'){box.textContent='서버 합성 실패: '+(j.detail||j.stage);box.className='status error';localStorage.removeItem(key(project.id));return true;}
  return false;
 }
 async function render({project,files,voice,bgVolume,narrationVolume,quality,box,onProgress}){
  await ensureAccess();box.textContent='서버에 영상 업로드를 준비하고 있습니다.';
  const projectData={title:project.title,story:project.story,cuts:project.cuts,characters:project.characters,scenes:project.scenes};
  const created=await request('/api/projects','POST',projectData),id=created.id;
  for(let i=0;i<project.cuts;i++){
   const file=files.get(i);if(!file)throw Error('컷 '+(i+1)+' 파일이 없습니다.');
   onProgress({percent:Math.floor(i/project.cuts*25),phase:'영상 업로드 '+(i+1)+'/'+project.cuts,detail:file.name});
   const u=await request('/api/projects/'+id+'/cuts/'+i+'/upload-url','POST',{size:file.size,fileName:file.name});
   const put=await fetch(u.url,{method:'PUT',headers:{'Content-Type':u.contentType},body:file});
   if(!put.ok)throw Error('컷 '+(i+1)+' 업로드 실패 HTTP '+put.status+' · 업로드 파일은 유지됩니다.');
   await request('/api/projects/'+id+'/cuts/'+i+'/complete','POST',{});
  }
  const voices={dad:'Charon',grandma:'Kore',grandpa:'Iapetus'};
  const j=await request('/api/projects/'+id+'/render','POST',{voice:voices[voice]||voice||'Charon',backgroundVolume:Number(bgVolume),narrationVolume:Number(narrationVolume),quality});
  localStorage.setItem(key(project.id),JSON.stringify({serverId:id,jobId:j.jobId}));
  onProgress({percent:25,phase:'GitHub Actions 합성 요청 완료',detail:'이제 크롬을 닫아도 서버에서 작업합니다.'});
  box.textContent='서버 합성 중입니다. 이 페이지를 닫았다가 나중에 다시 열어도 됩니다.';
  const tick=async()=>{try{const done=await poll(project,box,onProgress);if(!done)setTimeout(tick,12000);}catch(e){box.textContent='진행상황 연결 재시도 중: '+e.message;setTimeout(tick,20000);}};
  setTimeout(tick,3000);
 }
 async function resume(project,box,onProgress){
  if(!localStorage.getItem(key(project.id)))return;
  try{await ensureAccess();const done=await poll(project,box,onProgress);if(!done){const tick=async()=>{try{if(!await poll(project,box,onProgress))setTimeout(tick,12000);}catch{setTimeout(tick,20000);}};setTimeout(tick,12000);}}
  catch(e){box.textContent='서버 작업 조회 대기: '+e.message;}
 }
 return {render,resume,health};
})();