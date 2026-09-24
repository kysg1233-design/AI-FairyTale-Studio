const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const path of ['/','/studio-v6.html']){
   const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8765'+path,{waitUntil:'load'});
   const values=await page.locator('#cuts option').evaluateAll(xs=>xs.map(x=>Number(x.value)));
   if(JSON.stringify(values)!==JSON.stringify([9,12,15,18,20]))throw Error(path+' cut options invalid: '+values);
   if(await page.locator('#cuts').inputValue()!=='15')throw Error(path+' default must be 15');
   await page.locator('#cuts').selectOption('20');
   if(await page.locator('#cuts').inputValue()!=='20')throw Error(path+' cannot select 20');
   await page.locator('#connect').click();
   if(!await page.locator('#authDialog').evaluate(e=>e.open))throw Error(path+' API dialog missing');
   await page.locator('#cancelAuth').click();
   if(errors.length)throw Error(path+' browser errors: '+errors.join(' | '));
   console.log('MOBILE UI PASS',path,'9/12/15/18/20 cuts; default 15; select 20');
   await page.close();
  }
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(()=>sessionStorage.setItem('fairytale-gemini-key','test-key'));
  await page.reload();
  let calls=0;
  const story='옛날 총각이 논을 갈았어요. 우렁이를 발견하고 물독에 넣었어요. 각시가 밥을 지었어요. 둘은 행복하게 살았어요.';
  const source=['옛날 총각이 논을 갈았어요.','우렁이를 발견하고 물독에 넣었어요.','각시가 밥을 지었어요.','둘은 행복하게 살았어요.'];
  await page.route('https://generativelanguage.googleapis.com/**',route=>{
   calls++;
   const msg=JSON.parse(route.request().postData()).contents[0].parts[0].text;
   if(calls===1&&!msg.includes('STORY PLAN FIRST PASS'))throw Error('Missing story plan');
   if(calls===2&&!msg.includes('STORY_PLAN (immutable beat order'))throw Error('Missing story plan');
   const beats=Array.from({length:15},(_,i)=>({title:'사건 '+(i+1),cause:'앞 사건의 결과',event:'총각의 이야기 '+(i+1),result:'다음 사건의 원인',sourceExcerpt:source[Math.min(3,Math.floor(i/4))],timePlace:'낮 논'}));
   const plan={opening:'총각의 농사',centralConflict:'우렁이의 정체',originalEnding:'둘은 행복하게 살았어요.',beats};
   const scenes=beats.map((b,i)=>({title:b.title,characterNames:['총각'],imagePrompt:'The farmer in his field.',veoPrompt:'The farmer works in his field.',narration:'총각은 논에서 새로운 일을 겪었어요.'}));
   const answer=calls===1?plan:{characters:[{name:'총각',prompt:'Oval face, brown eyes, blue hanbok.'}],scenes};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]})});
  });
  await page.locator('#title').fill('우렁각시');
  await page.locator('#story').fill(story);
  await page.locator('#cuts').selectOption('15');
  await page.locator('#generate').click();
  await page.locator('#step2').waitFor({state:'visible',timeout:15000});
  const project=await page.evaluate(()=>JSON.parse(localStorage.getItem('fairytale-local-v1')).project);
  if(calls!==2||project.scenes.length!==15||project.storyPlan.beats.length!==15)throw Error('15-cut generation failed');
  if(!project.scenes[0].veoPrompt.includes('SOURCE STORY LOCK')||!project.scenes[0].veoPrompt.includes('CHARACTER REFERENCE / IDENTITY LOCK'))throw Error('Source or identity lock missing');
  console.log('GENERATION PASS: 15 causal source-anchored cuts and locked character prompts');
  await page.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
