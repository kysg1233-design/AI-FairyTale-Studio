import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const MAX_FILE = 1024 * 1024 * 1024; // one GiB per cut (single PUT)
const iso = () => new Date().toISOString();
const fail = (msg, code = 400) => new Response(JSON.stringify({error:msg}),{status:code,headers:{'Content-Type':'application/json'}});
const okay = (obj, code = 200) => new Response(JSON.stringify(obj),{status:code,headers:{'Content-Type':'application/json'}});
const keyProject = id => 'p:'+id;
const keyJob = id => 'j:'+id;
const safeId = s => /^[0-9a-f-]{36}$/.test(s || '');
const encode = value => new TextEncoder().encode(value);
async function same(a,b) {
 if (!a || !b || a.length!==b.length) return false;
 const [ha,hb]=await Promise.all([crypto.subtle.digest('SHA-256',encode(a)),crypto.subtle.digest('SHA-256',encode(b))]);
 return [...new Uint8Array(ha)].every((x,i)=>x===new Uint8Array(hb)[i]);
}
async function get(env,id) { return env.DATA.get(keyProject(id),'json'); }
async function set(env,p) { p.updatedAt=iso(); await env.DATA.put(keyProject(p.id),JSON.stringify(p)); }
async function job(env,id) { return env.DATA.get(keyJob(id),'json'); }
async function putJob(env,j) { j.updatedAt=iso(); await env.DATA.put(keyJob(j.id),JSON.stringify(j)); }
const getIndex = async env => await env.DATA.get('projects:index','json') || [];
const putIndex = async (env,index) => env.DATA.put('projects:index',JSON.stringify(index));
function client(env) {
 return new S3Client({region:'auto',
  endpoint:'https://'+env.R2_ACCOUNT_ID+'.r2.cloudflarestorage.com',
  credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},
  forcePathStyle:true});
}
async function signed(env,method,key,contentType) {
 const c=client(env);
 const cmd=method==='PUT'?new PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key,ContentType:contentType}):
  new GetObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key});
 return getSignedUrl(c,cmd,{expiresIn:method==='PUT'?900:7200});
}
async function body(request) {try{return await request.json();}catch{throw Error('요청 내용을 읽을 수 없습니다.');}}
function validateScenes(chars,scenes,cuts) {
 if(!Array.isArray(chars)||!Array.isArray(scenes)||scenes.length!==cuts||cuts<1||cuts>10)throw Error('AI가 선택한 컷수의 결과를 반환하지 않았습니다.');
 if(chars.length>30)throw Error('캐릭터 수가 너무 많습니다.');
 for(const c of chars)if(typeof c.name!=='string'||typeof c.prompt!=='string'||!c.prompt.trim())throw Error('캐릭터 프롬프트가 비어 있습니다.');
 for(const s of scenes){
  if(['title','imagePrompt','veoPrompt','narration'].some(k=>typeof s[k]!=='string'||!s[k].trim()))
   throw Error('일부 장면 프롬프트 또는 나레이션이 누락됐습니다.');
 }
}
const schema = {type:'OBJECT',properties:{
 characters:{type:'ARRAY',items:{type:'OBJECT',properties:{name:{type:'STRING'},prompt:{type:'STRING'}},required:['name','prompt']}},
 scenes:{type:'ARRAY',items:{type:'OBJECT',properties:{
  title:{type:'STRING'},imagePrompt:{type:'STRING'},veoPrompt:{type:'STRING'},narration:{type:'STRING'}
 },required:['title','imagePrompt','veoPrompt','narration']}}
},required:['characters','scenes']};
const NO_SOUND='ABSOLUTE AUDIO RULE: No dialogue, no speech, no narration, no voice-over, no singing, no vocals, no human or animal speaking, no lip-sync or mouth movements suggesting speech. Only instrumental background music, subtle ambience and natural sound effects.';
const NO_TEXT='ABSOLUTE VISUAL RULE: No text of any kind in the frames: no scene numbers, titles, chapter names, intro cards, subtitles, speech bubbles, captions, logos, watermarks, readable signs, labels or writing on props.';
async function gemini(env,title,story,cuts) {
 const prompt=`You are a senior children's bedtime-film storyboard director. Return EXACTLY ${cuts} scenes; do not divide by character count. Preserve every essential event and ending in the original Korean story. Allocate setup/development/crisis/resolution naturally. Style: warm fairy-tale animation. For each MAIN character return an English text-to-image reference prompt with unchanging age, face, hair, physique, wardrobe, palette and accessories. For each scene return (1) complete independent English 9:16 scene image prompt with all on-screen characters fully described; (2) complete independent English Google Veo prompt including consistent character appearance, background, action, expressions, lens/framing, camera movement, lighting, warm animation and 9:16, around 10 seconds; (3) short smooth Korean bedtime-dad narration targeted at 10 seconds, no cut-off sentences. No dialogue should be spoken in video, because Korean voice will be added separately. All Veo prompts must prohibit any text on screen. Do not alter the ending. TITLE: ${title}\nSTORY:\n${story}`;
 const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{
 method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
 body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,maxOutputTokens:16384,temperature:0.6}})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Gemini 호출 오류 HTTP '+response.status+': '+(result.error?.message || 'API 키·무료 할당량·모델 접근을 확인해 주세요.'));
 const text=result.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('');
 if(!text)throw Error('Gemini가 빈 결과를 반환했습니다.');
 let data;try{data=JSON.parse(text);}catch{throw Error('Gemini 응답이 올바른 JSON 형식이 아닙니다.');}
 validateScenes(data.characters,data.scenes,cuts);
 data.scenes.forEach(s=>{s.veoPrompt=s.veoPrompt+'\n'+NO_SOUND+'\n'+NO_TEXT;});
 return data;
}
async function runDispatch(env,j) {
 const url=`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/actions/workflows/render.yml/dispatches`;
 const resp=await fetch(url,{method:'POST',headers:{
 'Authorization':'Bearer '+env.GITHUB_ACTIONS_TOKEN,'Accept':'application/vnd.github+json',
 'X-GitHub-Api-Version':'2022-11-28','User-Agent':'fairytale-studio-worker','Content-Type':'application/json'},
 body:JSON.stringify({ref:'main',inputs:{job_id:j.id}})});
 if(resp.status!==204)throw Error('GitHub Actions 실행 요청 실패 (HTTP '+resp.status+'). 비공개 저장소·Actions 토큰 설정을 확인해 주세요.');
}
async function route(request,env,url) {
 const parts=url.pathname.split('/').filter(Boolean),method=request.method;
 if(parts[0]==='internal') {
  if(!(await same((request.headers.get('Authorization')||'').replace(/^Bearer /i,''),env.WORKER_JOB_KEY)))return fail('인증 실패',401);
  const id=parts[2];
  if(parts[1]!=='jobs'||!safeId(id))return fail('알 수 없는 작업',404);
  const j=await job(env,id);if(!j)return fail('작업이 없습니다.',404);
  const p=await get(env,j.projectId);if(!p)return fail('프로젝트가 삭제됐습니다.',404);
  if(method==='GET'&&parts[3]==='manifest'){
   const videos=[];
   for(let i=0;i<p.cuts;i++){
    const v=p.videos?.[i];if(!v?.ready)throw Error('컷 '+(i+1)+' 영상 없음');
    videos.push({index:i,sourceUrl:await signed(env,'GET',v.key),narration:p.scenes[i].narration});
   }
   return okay({jobId:id,projectId:p.id,cuts:p.cuts,voice:j.voice,narrationVolume:j.narrationVolume,
    backgroundVolume:j.backgroundVolume,videos,
    outputUrl:await signed(env,'PUT',j.outputKey,'video/mp4'),outputKey:j.outputKey});
  }
  if(method==='POST'&&parts[3]==='status'){
   const d=await body(request);
   if(!['queued','running','failed','complete'].includes(d.status)||typeof d.stage!=='string')return fail('상태 형식 오류');
   if(j.status==='complete'||j.status==='failed')return fail('종료된 작업',409);
   if(d.status==='complete'){
    const x=await env.VIDEOS.head(j.outputKey);
    if(!x||x.size<10000)return fail('최종 MP4가 R2에 실제로 존재하지 않습니다.',409);
    p.completed=true;await set(env,p);
   }
   j.status=d.status;j.stage=d.stage.slice(0,150);j.detail=String(d.detail||'').slice(0,300);
   await putJob(env,j);return okay({ok:true});
  }
  return fail('지원하지 않는 내부 요청',404);
 }
 if(parts[0]!=='api')return fail('지원하지 않는 경로',404);
 if(!(await same(request.headers.get('X-Studio-Token'),env.STUDIO_ACCESS_KEY)))return fail('스튜디오 접근키가 올바르지 않습니다.',401);
 if(parts[1]==='generate'&&method==='POST'){
  const d=await body(request),cuts=Number(d.cuts);
  if(typeof d.title!=='string'||!d.title.trim()||d.title.length>120||
    typeof d.story!=='string'||!d.story.trim()||d.story.length>30000||
    !Number.isInteger(cuts)||cuts<1||cuts>10)return fail('동화 입력 또는 컷수 형식이 올바르지 않습니다.');
  const v=await gemini(env,d.title.trim(),d.story.trim(),cuts),id=crypto.randomUUID();
  const p={id,title:d.title.trim(),story:d.story.trim(),cuts,characters:v.characters,scenes:v.scenes,videos:{},
   createdAt:iso(),updatedAt:iso(),completed:false,jobId:null};
  await set(env,p);const ids=await getIndex(env);ids.unshift(id);await putIndex(env,ids);
  return okay(p,201);
 }
 if(parts[1]==='projects'&&parts.length===2&&method==='GET'){
  const ids=await getIndex(env),ps=await Promise.all(ids.map(id=>get(env,id)));
  return okay({projects:ps.filter(Boolean).map(p=>({id:p.id,title:p.title,cuts:p.cuts,completed:p.completed,createdAt:p.createdAt}))});
 }
 if(parts[1]==='projects'&&safeId(parts[2])) {
  const id=parts[2],p=await get(env,id);if(!p)return fail('프로젝트가 없습니다.',404);
  if(parts.length===3&&method==='GET')return okay(p);
  if(parts.length===3&&method==='PATCH'){
   const d=await body(request);validateScenes(d.characters,d.scenes,p.cuts);
   p.characters=d.characters;p.scenes=d.scenes;p.completed=false;await set(env,p);return okay({ok:true});
  }
  if(parts.length===3&&method==='DELETE'){
   const keys=Object.values(p.videos||{}).filter(Boolean).map(v=>v.key);
   if(p.jobId){const j=await job(env,p.jobId);if(j){if(j.status==='running'||j.status==='queued')return fail('합성 진행 중에는 삭제할 수 없습니다.',409);if(j.outputKey)keys.push(j.outputKey);await env.DATA.delete(keyJob(p.jobId));}}
   await Promise.all(keys.map(k=>env.VIDEOS.delete(k)));await env.DATA.delete(keyProject(id));
   await putIndex(env,(await getIndex(env)).filter(x=>x!==id));return okay({ok:true});
  }
  if(parts[3]==='cuts'&&/^\d+$/.test(parts[4]||'')){
   const i=Number(parts[4]);if(i<0||i>=p.cuts)return fail('존재하지 않는 컷',404);
   if(parts[5]==='upload-url'&&method==='POST'){
    const d=await body(request),size=Number(d.size),fileName=String(d.fileName||'');
    if(!/\.(mp4|mov|webm|m4v)$/i.test(fileName)||!Number.isInteger(size)||size<1||size>MAX_FILE)return fail('허용되지 않는 영상 형식 또는 파일 크기 (최대 1GiB)');
    const contentType={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.m4v':'video/x-m4v'}[fileName.match(/\.[^.]+$/)[0].toLowerCase()];
    const objectKey=`projects/${id}/cuts/${i}/${crypto.randomUUID()}`;
    const url=await signed(env,'PUT',objectKey,contentType);
    await env.DATA.put(`upload:${id}:${i}`,JSON.stringify({objectKey,size,fileName:fileName.slice(0,180),contentType}),{expirationTtl:1800});
    return okay({url,contentType});
   }
   if(parts[5]==='complete'&&method==='POST'){
    const pending=await env.DATA.get(`upload:${id}:${i}`,'json');if(!pending)return fail('업로드 요청이 만료됐습니다. 다시 파일을 선택해 주세요.',409);
    const h=await env.VIDEOS.head(pending.objectKey);
    if(!h||h.size!==pending.size)return fail('R2 저장을 확인하지 못했거나 파일 크기가 다릅니다.',409);
    const old=p.videos?.[i]?.key;p.videos[i]={ready:true,key:pending.objectKey,size:h.size,fileName:pending.fileName};p.completed=false;
    await set(env,p);await env.DATA.delete(`upload:${id}:${i}`);if(old && old!==pending.objectKey)await env.VIDEOS.delete(old);
    return okay({ready:true});
   }
   if(parts[5]==='preview'&&method==='GET'){
    const v=p.videos?.[i];if(!v?.ready)return fail('영상이 없습니다.',404);
    return okay({url:await signed(env,'GET',v.key)});
   }
   if(parts.length===5&&method==='DELETE'){
    const v=p.videos?.[i];if(v?.key)await env.VIDEOS.delete(v.key);
    delete p.videos[i];p.completed=false;await set(env,p);return okay({ok:true});
   }
  }
  if(parts[3]==='render'&&method==='POST'){
   if(p.jobId){const old=await job(env,p.jobId);if(['running','queued'].includes(old?.status))return fail('이미 영상 합성 중입니다.',409);}
   for(let i=0;i<p.cuts;i++){
    const v=p.videos?.[i];if(!v?.ready || !(await env.VIDEOS.head(v.key)))return fail('컷 '+(i+1)+' 영상이 준비되지 않았습니다.',409);
   }
   const d=await body(request),voice=String(d.voice||'Charon');
   if(!['Charon','Iapetus','Puck','Kore'].includes(voice))return fail('지원하지 않는 목소리');
   const nv=Number(d.narrationVolume),bv=Number(d.backgroundVolume);
   if(!Number.isFinite(nv)||nv<0.3||nv>1.5||!Number.isFinite(bv)||bv<0||bv>1)return fail('음량 설정이 올바르지 않습니다.');
   const idJob=crypto.randomUUID(),j={id:idJob,projectId:id,status:'queued',stage:'GitHub Actions 실행 요청 중',
    voice,narrationVolume:nv,backgroundVolume:bv,outputKey:`projects/${id}/outputs/${idJob}.mp4`,createdAt:iso()};
   await putJob(env,j);p.jobId=idJob;p.completed=false;await set(env,p);
   try{await runDispatch(env,j);}catch(e){j.status='failed';j.stage='작업 시작 실패';j.detail=e.message;await putJob(env,j);throw e;}
   return okay({jobId:idJob},202);
  }
  if(parts[3]==='download'&&method==='GET'){
   if(!p.completed||!p.jobId)return fail('완성 영상이 아직 없습니다.',409);
   const j=await job(env,p.jobId),o=j?.outputKey?await env.VIDEOS.head(j.outputKey):null;
   if(j?.status!=='complete'||!o)return fail('MP4가 확인되지 않았습니다.',409);
   return okay({url:await signed(env,'GET',j.outputKey)});
  }
 }
 if(parts[1]==='jobs'&&safeId(parts[2])&&method==='GET'){
  const j=await job(env,parts[2]);if(!j)return fail('작업 정보가 없습니다.',404);
  return okay({status:j.status,stage:j.stage,detail:j.detail||''});
 }
 return fail('해당 기능을 찾을 수 없습니다.',404);
}
export default {
 async fetch(request,env) {
  const origin=request.headers.get('Origin')||'';
  const allow=origin && origin===env.ALLOWED_ORIGIN;
  const cors={'Access-Control-Allow-Origin':allow?origin:env.ALLOWED_ORIGIN,
   'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS',
   'Access-Control-Allow-Headers':'Content-Type,X-Studio-Token,Authorization',
   'Access-Control-Max-Age':'600'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(request.url);
  try {
   if(!env.DATA||!env.VIDEOS||!env.STUDIO_ACCESS_KEY||!env.GEMINI_API_KEY||!env.R2_ACCESS_KEY_ID||
    !env.R2_SECRET_ACCESS_KEY||!env.R2_ACCOUNT_ID||!env.R2_BUCKET_NAME||
    !env.GITHUB_ACTIONS_TOKEN||!env.WORKER_JOB_KEY)throw Error('필수 서버 설정이 완료되지 않았습니다.');
   const r=await route(request,env,url);Object.entries(cors).forEach(([k,v])=>r.headers.set(k,v));return r;
  }catch(e){
   const r=fail(e.message||'서버 내부 오류',e.message?.includes('Gemini')?502:500);
   Object.entries(cors).forEach(([k,v])=>r.headers.set(k,v));return r;
  }
 }
};
