/* Real Chrome reading-flow smoke test; runs on GitHub Actions before and after Pages deployment.
 * Tests actual media loading, interaction, search, favourites, flipbook and music.
 * The test never calls Gemini; it only reads already-published story assets.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const root=process.env.SAKURA_URL||'http://127.0.0.1:8777/sakura/';
const expected=JSON.parse(fs.readFileSync('sakura/books/index.json','utf8')).books.length;
const report={url:root,started_at:new Date().toISOString(),expected_books:expected,scenarios:[],success:false};
async function tryCase(name,mobile=false){
 const result={name,success:false,checks:{},errors:[]};
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1365,height:900},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();
  page.on('pageerror',error=>result.errors.push('Browser JavaScript: '+error.message));
  const resp=await page.goto(root,{waitUntil:'domcontentloaded',timeout:35000});
  if(!resp||resp.status()!==200)throw Error('Homepage HTTP '+(resp?.status()||'unreachable'));
  await page.waitForFunction(()=>document.querySelector('#bookCount')?.textContent.includes('권'),null,{timeout:20000});
  await page.waitForTimeout(1800);
  const reported=Number((await page.locator('#bookCount').textContent()).replace(/\D/g,'')),cards=await page.locator('#library .tile').count();
  if(cards!==expected||reported!==expected)throw Error('Book count mismatch: actual='+cards+', UI='+reported+', catalog='+expected);
  result.checks.book_count=cards;
  const sourceCount=await page.evaluate(async()=>{const r=await fetch('./books/candidates.json');if(!r.ok)throw Error('Story queue unavailable');return (await r.json()).length});
  if(sourceCount<100)throw Error('Production queue has fewer than 100 sourced candidates');
  result.checks.source_backed_candidates=sourceCount;
  if(expected<1)throw Error('No complete books in release catalog');
  const cover=page.locator('#library .tile img').first();
  await cover.evaluate(img=>img.decode());result.checks.cover_decoded=true;
  const names=await page.locator('#library .tile strong').allTextContents();
  const filter=page.locator('[data-cat="이솝"]');await filter.click();await page.waitForTimeout(200);
  result.checks.category_count=await page.locator('#library .tile').count();
  await page.locator('[data-cat="all"]').click();
  const firstName=names[0];
  await page.locator('#search').fill(firstName);
  if(await page.locator('#library .tile').count()<1)throw Error('Search did not match book');
  await page.locator('#search').fill('');
  await page.locator('#library .faveBtn').first().click();
  await page.locator('[data-mode="favs"]').click();
  if(await page.locator('#library .tile').count()<1)throw Error('Favourite was not persisted');
  result.checks.favourites=true;await page.locator('[data-mode="all"]').click();
  await page.locator('#library .tile button[aria-label$="읽기"]').first().click();
  await page.waitForFunction(()=>document.querySelector('#reader')?.style.display==='block'&&document.querySelector('#book')?.style.display==='block'&&typeof flip!=="undefined"&&flip!=null,null,{timeout:70000});
  result.checks.story_opened=true;
  const loaded=await page.evaluate(()=>({
    pageIndex:flip.getCurrentPageIndex(),
    imageCount:document.querySelectorAll('.leaf img').length,
    renderedImageCount:[...document.querySelectorAll('.leaf img')].filter(x=>x.complete&&x.naturalWidth>0).length,
    audioReady:decoded.size,
    titleAudio:active.title_audio?.male?true:false,
    introScheduled:!!introTrack,
    chapterCount:active.pages.length,
    bgmReady:!!musicTrack,volume:musicTrack?.volume,readAudioState:ctx?.state
  }));
  if(loaded.imageCount!==loaded.chapterCount||loaded.renderedImageCount!==loaded.chapterCount)throw Error('Some story page images did not decode: '+JSON.stringify(loaded));
  if(loaded.audioReady!==loaded.chapterCount+(loaded.titleAudio?1:0))throw Error('Not all page narrations predecoded: '+JSON.stringify(loaded));
  if(loaded.titleAudio&&!loaded.introScheduled)throw Error('Book title is not scheduled to play before page narration');
  if(!loaded.bgmReady)throw Error('Background soundtrack has not started');
  await page.waitForFunction(()=>musicTrack&&musicTrack.volume>=.20,null,{timeout:8000});
  if(loaded.volume>.55)throw Error('Background soundtrack is too loud for narration');
  await page.waitForFunction(()=>musicTrack && musicTrack.readyState>=2,null,{timeout:25000});
  result.checks.media=loaded;
  const textPages=await page.evaluate(()=>[...document.querySelectorAll('#book .leaf .words')].map(x=>({client:x.clientHeight,scroll:x.scrollHeight,overflow:getComputedStyle(x).overflowY}))); 
  if(textPages.length!==loaded.chapterCount||textPages.some(x=>x.client>0&&x.scroll>x.client+2&&x.overflow!=='auto'))throw Error('Text clipped on page: '+JSON.stringify(textPages));
  result.checks.page_text_fits=true;
  const playing=await page.evaluate(()=>Boolean(musicTrack&&!musicTrack.paused&&musicTrack.readyState>=2));
  if(!playing)throw Error('Background music resource loaded but actual playback has not started');
  result.checks.bgm_playing=true;
  const music=await page.evaluate(()=>({
   themes:Object.keys(musicNames),
   current:musicTheme,
   playing:!!musicTrack&&!musicTrack.paused,
   volume:musicTrack?.volume,
   selected:active.pages.map(p=>sceneMood(p))
  }));
  if(music.themes.length!==5)throw Error('Expected five pre-rendered mood soundtracks: '+JSON.stringify(music));
  const responds=await page.evaluate(async()=>Promise.all(Object.values(musicNames).map(async file=>{
   const r=await fetch('./assets/'+file);return {file,status:r.status,size:(await r.blob()).size}
  })));
  if(responds.some(x=>x.status!==200||x.size<80000))throw Error('A pre-made mood track missing: '+JSON.stringify(responds));
  const change=await page.evaluate(()=>{
   const prev=musicTheme,other=prev==='adventure'?'joyful':'adventure';
   playMusic(other);return {prev,other}
  });
  await page.waitForFunction(target=>musicTheme===target&&musicTrack&&!musicTrack.paused&&musicTrack.readyState>=2,change.other,{timeout:16000});
  await page.evaluate(()=>{playMusic(sceneMood(active.pages[currentPage]))});
  result.checks.mood_music={tracks:responds.map(x=>x.file),switch:change,per_scene:music.selected};
  await page.locator('#voice').selectOption('female');
  await page.waitForFunction(()=>decoded.size>=active.pages.length*2,null,{timeout:45000});
  if(await page.locator('#loading').isVisible())await page.locator('#loading').waitFor({state:'hidden',timeout:10000});
  result.checks.both_male_female_audio_decoded=true;
  await page.locator('#voice').selectOption('male');
  const book=page.locator('#book');await book.scrollIntoViewIfNeeded();const box=await book.boundingBox();
  if(!box)throw Error('No book visible for drag');
  const right=box.x+box.width-28,centerY=box.y+box.height*.64;
  if(mobile){
   const cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:right,y:centerY}]});
   for(let n=1;n<=18;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:right-(box.width*.58)*n/18,y:centerY}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{
   await page.mouse.move(right,centerY);await page.mouse.down();
   await page.mouse.move(right-box.width*.58,centerY,{steps:20});await page.mouse.up();
  }
  await page.waitForTimeout(1450);
  const newIndex=await page.evaluate(()=>flip.getCurrentPageIndex());
  result.checks.drag={before:loaded.pageIndex,after:newIndex};
  if(newIndex===loaded.pageIndex)throw Error('User drag did not turn the page');
  await page.locator('#back').click();
  if(!await page.locator('#home').isVisible())throw Error('Back navigation failed');
  result.checks.return_to_library=true;
  result.success=true;
  await page.screenshot({path:'sakura/qa-'+name+'.png',fullPage:true});
  await context.close();
 }catch(e){result.errors.push(String(e.stack||e))}
 finally{if(browser)await browser.close();report.scenarios.push(result)}
}
(async()=>{
 await tryCase('desktop',false);
 await tryCase('galaxy-mobile',true);
 report.success=report.scenarios.every(x=>x.success);
 report.finished_at=new Date().toISOString();
 fs.writeFileSync('sakura/qa-result.json',JSON.stringify(report,null,2)+'\n');
 console.log('SAKURA_BROWSER_QA:',JSON.stringify({success:report.success,results:report.scenarios.map(x=>({name:x.name,success:x.success,checks:x.checks,errors:x.errors.map(e=>e.slice(0,550))}))},null,2));
 if(!report.success)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
