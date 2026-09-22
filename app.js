'use strict';
const $ = id => document.getElementById(id);
const API = window.FAIRYTALE_CONFIG || {};
const KEY = 'fairytale-studio-v2';
const state = {project:null,step:1,token:sessionStorage.getItem('fairytale-access') || '',uploading:new Set(),timer:null,busy:false};
const node = (tag,cls,content) => {const x=document.createElement(tag);if(cls)x.className=cls;if(content!==undefined)x.textContent=content;return x;};
const persist = () => localStorage.setItem(KEY,JSON.stringify({project:state.project,step:state.step}));
function message(s,bad=false){$('notice').textContent=s;$('notice').className='notice'+(bad?' error':'');}
function clearMessage(){$('notice').className='notice hidden';$('notice').textContent='';}
async function api(path,method='GET',data) {
 if(!API.apiBase)throw Error('제작 서버가 아직 연결되지 않았습니다. Cloudflare 설정 이후 이용할 수 있습니다.');
 if(!state.token)throw Error('상단 연결 설정에서 개인용 접근키를 입력해 주세요.');
 const headers={'X-Studio-Token':state.token};
 if(data!==undefined)headers['Content-Type']='application/json';
 let r;try{r=await fetch(API.apiBase.replace(/\/$/,'')+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});}catch{throw Error('제작 서버에 연결할 수 없습니다. 인터넷과 서버 주소를 확인해 주세요.');}
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(j.error || '서버 오류 (HTTP '+r.status+')');
 return j;
}
function step(n){
 if(n>1 && !state.project?.scenes?.length)return;
 state.step=n;
 for(let i=1;i<=3;i++)$('step'+i).classList.toggle('hidden',i!==n);
 document.querySelectorAll('.step').forEach(x=>{const yes=Number(x.dataset.step)===n;x.classList.toggle('active',yes);x.setAttribute('aria-current',yes?'step':'false');});
 if(n===3){uploads();history();if(state.project?.jobId)poll(state.project.jobId);}
 persist();window.scrollTo({top:0,behavior:'smooth'});
}
let saveTimer;
function saveLater(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{
 const p=state.project;if(!p)return;
 try{await api('/api/projects/'+p.id,'PATCH',{characters:p.characters,scenes:p.scenes});}
 catch(e){message('수정한 내용은 이 브라우저에 보관했습니다. 서버 저장 실패: '+e.message,true);}
},950);}
function edit(container,label,value,change,copy=true){
 const wrap=node('div');const row=node('div','field-heading');row.append(node('label','',label));
 const area=node('textarea',copy?'prompt-text':'narration');area.value=value||'';area.rows=copy?7:3;area.setAttribute('aria-label',label);
 area.addEventListener('input',()=>{change(area.value);persist();saveLater();});
 if(copy){const b=node('button','copy','복사');b.type='button';b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(area.value);b.textContent='복사됨 ✓';setTimeout(()=>b.textContent='복사',1400);}catch{message('복사할 수 없습니다. 텍스트를 길게 눌러 복사해 주세요.',true);}});row.append(b);}
 wrap.append(row,area);container.append(wrap);
}
function prompts(){
 const p=state.project;if(!p)return;
 $('countLabel').textContent=p.cuts+'컷';$('characters').replaceChildren();$('prompts').replaceChildren();
 (p.characters||[]).forEach((c,i)=>{const box=node('article','card');box.append(node('h4','',c.name||'캐릭터 '+(i+1)));edit(box,'캐릭터 이미지 프롬프트',c.prompt,v=>c.prompt=v);$('characters').append(box);});
 p.scenes.forEach((s,i)=>{const box=node('article','card');box.append(node('h4','','컷 '+(i+1)+' · '+(s.title||'장면')));edit(box,'장면 이미지 프롬프트',s.imagePrompt,v=>s.imagePrompt=v);edit(box,'Google Veo 영상 프롬프트',s.veoPrompt,v=>s.veoPrompt=v);edit(box,'한국어 나레이션',s.narration,v=>s.narration=v,false);$('prompts').append(box);});
}
function ready(p){return Array.from({length:p.cuts},(_,i)=>p.videos?.[i]).filter(v=>v?.ready).length;}
async function preview(p,i,v){
 try{const d=await api('/api/projects/'+p.id+'/cuts/'+i+'/preview');if(state.project?.id===p.id){v.src=d.url;v.classList.remove('hidden');}}catch(e){message('미리보기 주소를 확인하지 못했습니다: '+e.message,true);}
}
async function upload(p,i,file,status,button){
 if(!file || !/\.(mp4|mov|webm|m4v)$/i.test(file.name) || !file.size){message('MP4, MOV, WebM 또는 M4V 영상만 업로드할 수 있습니다.',true);return;}
 if(state.uploading.has(i))return;
 state.uploading.add(i);button.disabled=true;status.textContent='업로드 준비 중';
 try{
 const d=await api('/api/projects/'+p.id+'/cuts/'+i+'/upload-url','POST',{fileName:file.name,size:file.size,contentType:file.type||'video/mp4'});
 await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('PUT',d.url);x.setRequestHeader('Content-Type',d.contentType);x.upload.onprogress=e=>{if(e.lengthComputable)status.textContent='업로드 중 '+Math.floor(100*e.loaded/e.total)+'%';};x.onload=()=>x.status>=200&&x.status<300?resolve():reject(Error('R2 저장 실패: HTTP '+x.status));x.onerror=()=>reject(Error('영상 업로드 중 네트워크가 끊겼습니다.'));x.send(file);});
 const verified=await api('/api/projects/'+p.id+'/cuts/'+i+'/complete','POST',{fileName:file.name,size:file.size});
 if(!verified.ready)throw Error('서버에서 영상 저장 완료를 확인하지 못했습니다.');
 if(state.project?.id===p.id){p.videos[i]={ready:true,fileName:file.name,size:file.size};persist();}
 clearMessage();status.textContent='영상 준비 완료';
 }catch(e){message('컷 '+(i+1)+' 업로드 실패: '+e.message,true);status.textContent='업로드 실패';}
 finally{state.uploading.delete(i);uploads();}
}
function uploads(){
 const p=state.project;if(!p)return;
 const n=ready(p);$('uploadSummary').textContent='영상 준비: '+n+' / '+p.cuts+'컷';$('meterFill').style.width=100*n/p.cuts+'%';
 $('render').disabled=n!==p.cuts||state.uploading.size>0||state.busy;
 $('render').textContent=n===p.cuts?'영상 합치기 →':'모든 컷을 올려 주세요';
 const list=$('uploads');list.replaceChildren();
 p.scenes.forEach((s,i)=>{
 const v=p.videos?.[i];const box=node('article','card upload-card');
 const row=node('div','file-row');row.append(node('h4','','컷 '+(i+1)+' · '+(s.title||'장면')),node('span','badge'+(v?.ready?' ready':''),v?.ready?'영상 준비 완료':'영상 없음'));box.append(row);
 const status=node('p','',v?.ready?v.fileName:'영상 파일을 선택해 주세요.');box.append(status);
 const player=node('video',v?.ready?'':'hidden');player.controls=true;player.playsInline=true;box.append(player);if(v?.ready)preview(p,i,player);
 const file=node('input');file.type='file';file.accept='video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v';file.setAttribute('aria-label','컷 '+(i+1)+' 영상 선택');box.append(file);
 const buttons=node('div','actions');const send=node('button','secondary',v?.ready?'영상 교체':'선택 영상 업로드');send.type='button';send.disabled=true;
 file.addEventListener('change',()=>{if(!file.files[0])return;send.disabled=false;player.src=URL.createObjectURL(file.files[0]);player.classList.remove('hidden');status.textContent=file.files[0].name+' · 업로드 전';});
 send.addEventListener('click',()=>{if(file.files[0])upload(p,i,file.files[0],status,send);});buttons.append(send);
 if(v?.ready){const del=node('button','secondary','영상 삭제');del.type='button';del.addEventListener('click',async()=>{
 if(!confirm('컷 '+(i+1)+' 영상만 삭제할까요?'))return;del.disabled=true;
 try{await api('/api/projects/'+p.id+'/cuts/'+i,'DELETE');if(state.project?.id===p.id){delete p.videos[i];persist();uploads();}clearMessage();}
 catch(e){message('영상 삭제 실패: '+e.message,true);del.disabled=false;}
 });buttons.append(del);}
 box.append(buttons);edit(box,'한국어 나레이션',s.narration,v=>s.narration=v,false);list.append(box);
 });
}
async function poll(id){
 clearInterval(state.timer);if(!id)return;
 const check=async()=>{
  if(state.project?.jobId!==id){clearInterval(state.timer);return;}
  try{
   const j=await api('/api/jobs/'+id);const box=$('renderStatus');box.className='status'+(j.status==='failed'?' error':'');box.replaceChildren(node('strong','',j.status==='complete'?'완성 영상 준비 완료':j.status==='failed'?'영상 합성 실패':j.stage||'작업 대기 중'));
   if(j.detail)box.append(node('p','',j.detail));
   if(j.status==='complete'){
    const b=node('button','primary','최종 MP4 다운로드');b.type='button';b.addEventListener('click',async()=>{try{const d=await api('/api/projects/'+state.project.id+'/download');location.href=d.url;}catch(e){message('다운로드 실패: '+e.message,true);}});box.append(b);clearInterval(state.timer);history();
   }else if(j.status==='failed')clearInterval(state.timer);
  }catch(e){$('renderStatus').className='status error';$('renderStatus').textContent='진행 상황 조회 실패: '+e.message;}
 };
 await check();if(state.project?.jobId===id)state.timer=setInterval(check,4000);
}
async function history(){
 if(!API.apiBase||!state.token)return;
 const root=$('history');try{
  const r=await api('/api/projects');root.replaceChildren();
  if(!r.projects?.length){root.textContent='아직 제작 내역이 없습니다.';return;}
  r.projects.forEach(p=>{
   const box=node('article','card');box.append(node('h4','',p.title||'제목 없음'),node('p','',p.cuts+'컷 · '+(p.completed?'완료':'제작 중')+' · '+(p.createdAt?.slice(0,10)||'')));
   const actions=node('div','actions');
   if(p.completed){const b=node('button','secondary','완성 MP4 다운로드');b.type='button';b.onclick=async()=>{try{const d=await api('/api/projects/'+p.id+'/download');location.href=d.url;}catch(e){message(e.message,true);}};actions.append(b);}
   const open=node('button','secondary','이 동화 열기');open.type='button';open.onclick=async()=>{
    if(state.project?.id!==p.id && ($('title').value.trim()||$('story').value.trim()) &&
       !confirm('현재 열려 있는 작업 대신 선택한 동화를 열까요? 저장하지 않은 입력은 사라질 수 있습니다.'))return;
    try{
     const loaded=await api('/api/projects/'+p.id);
     if(!Array.isArray(loaded.scenes)||loaded.scenes.length!==loaded.cuts)throw Error('컷 정보가 올바르지 않습니다.');
     state.project=loaded;state.project.videos=loaded.videos||{};
     $('title').value=loaded.title||'';$('story').value=loaded.story||'';$('cuts').value=loaded.cuts;
     prompts();clearMessage();step(3);
    }catch(e){message('동화 열기 실패: '+e.message,true);}
   };actions.append(open);
   const del=node('button','secondary','제작 내역 삭제');del.type='button';del.onclick=async()=>{
    if(!confirm('이 동화의 서버 저장 영상과 완성본까지 삭제할까요?'))return;
    try{await api('/api/projects/'+p.id,'DELETE');if(state.project?.id===p.id){state.project=null;$('title').value='';$('story').value='';$('cuts').value='8';step(1);}history();}
    catch(e){message('제작 내역 삭제 실패: '+e.message,true);}
   };actions.append(del);box.append(actions);root.append(box);
  });
 }catch(e){root.textContent='제작 내역 조회 실패: '+e.message;}
}
async function generate(e){
 e.preventDefault();if(state.busy)return;clearMessage();
 const title=$('title').value.trim(),story=$('story').value.trim(),cuts=Number($('cuts').value);
 if(!title||!story){message('제목과 스토리를 입력해 주세요.',true);return;}
 if(!Number.isInteger(cuts)||cuts<1||cuts>10)return;
 state.busy=true;$('generate').disabled=true;$('generate').textContent='동화 분석·프롬프트 생성 중…';message('Gemini가 동화의 흐름을 분석하고 있습니다.');
 try{
  const p=await api('/api/generate','POST',{title,story,cuts});
  if(!Array.isArray(p.scenes)||p.scenes.length!==cuts||!Array.isArray(p.characters))throw Error('AI가 요청한 컷수의 결과를 반환하지 않았습니다.');
  p.videos=p.videos||{};state.project=p;persist();prompts();clearMessage();step(2);
 }catch(err){message('프롬프트 생성 실패: '+err.message,true);}
 finally{state.busy=false;$('generate').disabled=false;$('generate').textContent='AI 프롬프트 생성 →';}
}
function reset(){
 if(!confirm('새 동화를 시작할까요? 현재 열려 있는 입력과 컷 연결만 초기화합니다. 기존 서버 제작 내역은 따로 삭제할 수 있습니다.'))return;
 clearInterval(state.timer);clearTimeout(saveTimer);state.project=null;state.uploading.clear();localStorage.removeItem(KEY);
 $('title').value='';$('story').value='';$('cuts').value='8';$('characters').replaceChildren();$('prompts').replaceChildren();$('uploads').replaceChildren();$('renderStatus').className='status hidden';clearMessage();step(1);
}
async function finish(){
 const p=state.project;if(!p||ready(p)!==p.cuts||state.uploading.size)return;
 state.busy=true;$('render').disabled=true;
 try{
  clearTimeout(saveTimer);
  await api('/api/projects/'+p.id,'PATCH',{characters:p.characters,scenes:p.scenes});
  const j=await api('/api/projects/'+p.id+'/render','POST',{voice:$('voice').value,narrationVolume:Number($('narrationVolume').value)/100,backgroundVolume:Number($('backgroundVolume').value)/100});
  p.jobId=j.jobId;persist();await poll(j.jobId);
 }catch(e){message('영상 합성 시작 실패: '+e.message,true);}
 finally{state.busy=false;uploads();}
}
function init(){
 for(let i=1;i<=10;i++){const opt=node('option','',i+'컷');opt.value=i;if(i===8)opt.selected=true;$('cuts').append(opt);}
 try{const data=JSON.parse(localStorage.getItem(KEY)||'null');if(data?.project){state.project=data.project;$('title').value=data.project.title||'';$('story').value=data.project.story||'';$('cuts').value=data.project.cuts||8;prompts();step([1,2,3].includes(data.step)?data.step:1);}}catch{localStorage.removeItem(KEY);}
 document.querySelectorAll('.step').forEach(b=>b.onclick=()=>step(Number(b.dataset.step)));
 $('storyForm').onsubmit=generate;$('back1').onclick=()=>step(1);$('back2').onclick=()=>step(2);$('next3').onclick=()=>step(3);$('new').onclick=reset;$('render').onclick=finish;$('refresh').onclick=history;
 $('connect').onclick=()=>{$('token').value=state.token;$('authDialog').showModal();};
 $('cancelAuth').onclick=()=>$('authDialog').close();
 $('authForm').onsubmit=e=>{e.preventDefault();state.token=$('token').value;sessionStorage.setItem('fairytale-access',state.token);$('authDialog').close();message('접근키를 임시 저장했습니다. 실제 서버 연결은 프롬프트 요청 때 검증됩니다.');history();};
 for(const [a,b] of [['narrationVolume','narrationOut'],['backgroundVolume','backgroundOut']])$(a).oninput=()=>$(b).value=$(a).value+'%';
 if(state.project&&state.token&&API.apiBase)api('/api/projects/'+state.project.id).then(p=>{state.project={...state.project,...p};persist();if(state.step===3)uploads();}).catch(e=>message('서버에서 이전 작업을 조회하지 못했습니다: '+e.message,true));
}
init();
