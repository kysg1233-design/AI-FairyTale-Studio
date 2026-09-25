'use strict';
/* GitHub-only renderer. All user videos go to a PRIVATE GitHub repository.
 * GitHub PAT is held in sessionStorage only; never in public code or URL.
 * Git blobs are limited to 50 MiB per cut to avoid GitHub's 100 MiB file cap.
 */
const StudioServer=(()=>{
 const OWNER='kysg1233-design', REPO='AI-FairyTale-Worker';
 const store='fairytale-github-job-';
 const token=()=>sessionStorage.getItem('fairytale-github-token')||'';
 const api='https://api.github.com';
 const headers=()=>({'Accept':'application/vnd.github+json','Authorization':'Bearer '+token(),'X-GitHub-Api-Version':'2022-11-28'});
 async function call(path,method='GET',body){
  const r=await fetch(api+path,{method,headers:{...headers(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(r.status===204)return {};
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error('GitHub '+r.status+': '+(j.message||'요청 실패'));
  return j;
 }
 const path='/repos/'+OWNER+'/'+REPO;
 async function connect(){
  if(!token()){
   const t=prompt('비공개 GitHub 저장소에 접근할 GitHub 토큰을 입력하세요. 이 탭에만 보관하며 채팅이나 공개 저장소에 전송하지 않습니다.');
   if(!t)throw Error('GitHub 토큰이 필요합니다.');
   sessionStorage.setItem('fairytale-github-token',t.trim());
  }
  const r=await call(path);
  if(!r.private)throw Error('영상 저장소가 공개 상태입니다. 비공개 저장소만 허용합니다.');
  const w=await call(path+'/contents/.github/workflows/render.yml');
  if(!w.path)throw Error('비공개 저장소에 render.yml을 먼저 설치해야 합니다.');
 }
 async function blob(file){
  if(file.size>50*1024*1024)throw Error(file.name+' 용량이 50MiB를 초과합니다. GitHub Git 저장 제한으로 이 파일은 업로드할 수 없습니다.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return (await call(path+'/git/blobs','POST',{content:btoa(binary),encoding:'base64'})).sha;
 }
 const jobKey=id=>store+id;
 function progress(onProgress,percent,phase,detail){onProgress({percent,phase,detail});}
 async function render({project,files,voice,bgVolume,narrationVolume,quality,box,onProgress}){
  await connect();
  const id=crypto.randomUUID(), branch='jobs/'+id;
  const main=await call(path+'/git/ref/heads/main');
  await call(path+'/git/refs','POST',{ref:'refs/heads/'+branch,sha:main.object.sha});
  const tree=[];
  const voices={warmFemale:'Kore',calmMale:'Charon',storyteller:'Puck',grandma:'Kore',grandpa:'Iapetus'};
  const manifest={title:project.title,cuts:project.cuts,voice:voices[voice]||'Charon',backgroundVolume:Number(bgVolume),narrationVolume:Number(narrationVolume),quality:quality||'balanced',videos:[]};
  try{
   for(let i=0;i<project.cuts;i++){
    const file=files.get(i);if(!file)throw Error('컷 '+(i+1)+' 파일 없음');
    progress(onProgress,Math.floor(i/project.cuts*30),'GitHub 비공개 업로드 '+(i+1)+'/'+project.cuts,file.name);
    const sha=await blob(file),name='jobs/'+id+'/cut_'+String(i).padStart(2,'0')+'.mp4';
    tree.push({path:name,mode:'100644',type:'blob',sha});
    manifest.videos.push({path:name,narration:project.scenes[i].narration});
   }
   const manifestSha=(await call(path+'/git/blobs','POST',{content:JSON.stringify(manifest),encoding:'utf-8'})).sha;
   tree.push({path:'jobs/'+id+'/manifest.json',mode:'100644',type:'blob',sha:manifestSha});
   const base=await call(path+'/git/commits/'+main.object.sha);
   const t=await call(path+'/git/trees','POST',{base_tree:base.tree.sha,tree});
   const commit=await call(path+'/git/commits','POST',{message:'Private fairy tale render job '+id,tree:t.sha,parents:[main.object.sha]});
   await call(path+'/git/refs/heads/'+branch,'PATCH',{sha:commit.sha,force:false});
   progress(onProgress,35,'GitHub Actions 시작','업로드 완료. 이후에는 크롬을 닫아도 됩니다.');
   await call(path+'/actions/workflows/render.yml/dispatches','POST',{ref:branch,inputs:{job_id:id}});
   localStorage.setItem(jobKey(project.id),JSON.stringify({id,branch,started:Date.now()}));
   box.textContent='GitHub Actions에서 합성 중입니다. 이제 크롬을 닫아도 됩니다.';
   await resume(project,box,onProgress);
  }catch(e){throw Error(e.message+' (비공개 저장소 작업 브랜치 '+branch+' 확인)');}
 }
 async function resume(project,box,onProgress){
  const saved=JSON.parse(localStorage.getItem(jobKey(project.id))||'null');if(!saved)return;
  if(!token()){box.textContent='합성 작업이 저장되어 있습니다. 결과를 확인하려면 GitHub 토큰을 다시 입력하세요.';return;}
  let stop=false;
  async function tick(){
   if(stop)return;
   try{
    const r=await call(path+'/actions/workflows/render.yml/runs?branch='+encodeURIComponent(saved.branch)+'&per_page=10');
    const run=r.workflow_runs?.find(x=>x.head_branch===saved.branch);
    if(!run){progress(onProgress,36,'Actions 작업 대기','GitHub 실행을 기다리는 중');}
    else if(run.status!=='completed'){progress(onProgress,run.status==='in_progress'?55:40,'Actions '+run.status,'서버에서 MP4를 합성하고 있습니다.');}
    else if(run.conclusion!=='success'){box.className='status error';box.textContent='서버 합성 실패: '+run.conclusion+' · GitHub Actions 로그를 확인하세요.';stop=true;return;}
    else{
     const arts=await call(path+'/actions/runs/'+run.id+'/artifacts');
     const a=arts.artifacts?.find(x=>x.name==='fairytale-mp4-'+saved.id&&!x.expired);
     if(a){
      const link=document.createElement('a');link.className='primary';link.textContent='완성 MP4 받기 (GitHub 로그인 필요)';link.href='https://github.com/'+OWNER+'/'+REPO+'/actions/runs/'+run.id;link.target='_blank';link.rel='noopener';
      box.replaceChildren(link);progress(onProgress,100,'서버 합성 완료','GitHub Actions의 Artifacts에서 MP4를 받으세요.');
      stop=true;return;
     }
     progress(onProgress,95,'완성 파일 등록 중','GitHub Artifacts 반영을 기다립니다.');
    }
   }catch(e){box.textContent='작업 조회 오류: '+e.message;}
   setTimeout(tick,15000);
  }
  await tick();
 }
 return {render,resume,connect};
})();