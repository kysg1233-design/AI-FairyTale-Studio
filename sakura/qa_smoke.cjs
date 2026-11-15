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
  const leafCount=await page.locator('#book .storyLeaf').count();
  if(leafCount!==await page.evaluate(()=>active.pages.length))throw Error('Story must have one illustrated leaf per scene');
  if(await page.locator('#book .leaf').count()!==leafCount+1)throw Error('Last parent moral page missing from physical book');
  if(await page.locator('#book .moralLeaf').count()!==1)throw Error('Parent-read moral closing page missing');
  result.checks.one_leaf_per_scene=leafCount;
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
  if(responds.some(x=>![200,206].includes(x.status)||x.size<80000))throw Error('A pre-made mood track missing: '+JSON.stringify(responds));
  const change=await page.evaluate(()=>{
   const prev=musicTheme,other=prev==='adventure'?'joyful':'adventure';
   playMusic(other);return {prev,other}
  });
  await page.waitForFunction(target=>musicTheme===target&&musicTrack&&!musicTrack.paused&&musicTrack.readyState>=2,change.other,{timeout:16000});
  await page.evaluate(()=>{playMusic(sceneMood(active.pages[currentPage]))});
  result.checks.mood_music={tracks:responds.map(x=>x.file),switch:change,per_scene:music.selected};
  // Sound must go absolutely silent on OFF, even during a track crossfade.
  await page.evaluate(()=>playMusic('mystery'));
  await page.waitForTimeout(130);
  await page.locator('#music').click();
  const offState=await page.evaluate(()=>({
    enabled:musicOn,activeTrack:musicTrack===null,
    all:Array.from(musicCache.entries()).map(([theme,a])=>({theme,paused:a.paused,volume:a.volume}))
  }));
  await page.waitForTimeout(1500);
  const afterOff=await page.evaluate(()=>({
    enabled:musicOn,activeTrack:musicTrack===null,
    all:Array.from(musicCache.entries()).map(([theme,a])=>({theme,paused:a.paused,volume:a.volume}))
  }));
  for(const state of [offState,afterOff]){
   if(state.enabled||!state.activeTrack||state.all.some(a=>!a.paused||a.volume!==0))
    throw Error('BGM OFF must silence every cached player immediately, including fades: '+JSON.stringify(state));
  }
  result.checks.bgm_off_all_tracks_paused={immediate:offState,after_1500ms:afterOff};
  await page.evaluate(()=>playPage(1));
  const offAfterFlip=await page.evaluate(()=>({
   enabled:musicOn,playing:Array.from(musicCache.values()).filter(a=>!a.paused).length
  }));
  if(offAfterFlip.enabled||offAfterFlip.playing)throw Error('Page flip restarted background music with OFF');
  await page.locator('#quickMusic').click();
  await page.waitForFunction(()=>musicOn&&musicTrack&&!musicTrack.paused&&musicTrack.volume>=.2,null,{timeout:12000});
  await page.locator('#quickMusic').click();
  const quickOff=await page.evaluate(()=>({off:!musicOn,playing:Array.from(musicCache.values()).filter(a=>!a.paused||a.volume!==0).length}));
  if(!quickOff.off||quickOff.playing)throw Error('Quick OFF must silence music too: '+JSON.stringify(quickOff));
  result.checks.quick_music_off=true;
  // Exactly one HTMLAudioElement is used, even after changing moods repeatedly.
  await page.locator('#music').click();
  await page.waitForFunction(()=>musicOn&&musicTrack&&!musicTrack.paused,null,{timeout:12000});
  const singleBgm=await page.evaluate(async()=>{
    for(const mood of ['calm','joyful','mystery','tender','adventure']){
      playMusic(mood);await new Promise(r=>setTimeout(r,150));
    }
    await new Promise(r=>setTimeout(r,450));
    return {players:musicCache.size,playing:[...musicCache.values()].filter(a=>!a.paused&&a.volume>0).length,
      current:musicTheme};
  });
  if(singleBgm.players!==1||singleBgm.playing!==1)throw Error('Two background tracks are playing: '+JSON.stringify(singleBgm));
  result.checks.one_music_player_only=singleBgm;
  await page.locator('#music').click();
  await page.waitForTimeout(600);
  const allOff=await page.evaluate(()=>({on:musicOn,players:musicCache.size,
    playing:[...musicCache.values()].filter(a=>!a.paused||a.volume!==0).length}));
  if(allOff.on||allOff.playing!==0)throw Error('BGM off after repeated track changes failed: '+JSON.stringify(allOff));

  await page.locator('#music').click();
  await page.waitForFunction(()=>musicOn&&musicTrack&&!musicTrack.paused,null,{timeout:10000});
  // Restore page zero for the single-gesture flip test.
  await page.evaluate(()=>{flip.turnToPage(0);playPage(0)});
  await page.waitForTimeout(1000); // Let the page-flip engine finish and re-arm touch handling.

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
  await page.waitForTimeout(2750);
  const newIndex=await page.evaluate(()=>flip.getCurrentPageIndex());
  result.checks.drag={before:loaded.pageIndex,after:newIndex};
  if(newIndex!==loaded.pageIndex+1)throw Error('One gesture must turn exactly ONE story page: '+loaded.pageIndex+' -> '+newIndex);
  // Regression gate: a real RIGHTWARD finger drag MUST navigate backwards.
  // Earlier QA only tested the forward swipe, letting one-way readers deploy.
  await page.waitForTimeout(1250);
  const backStart=box.x+box.width*.32,backEnd=box.x+box.width*.86;
  if(mobile){
   const cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:backStart,y:centerY}]});
   for(let n=1;n<=18;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:backStart+(backEnd-backStart)*n/18,y:centerY}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{
   await page.mouse.move(backStart,centerY);await page.mouse.down();
   await page.mouse.move(backEnd,centerY,{steps:20});await page.mouse.up();
  }
  await page.waitForTimeout(2750);
  const previousIndex=await page.evaluate(()=>flip.getCurrentPageIndex());
  result.checks.reverse_drag={before:newIndex,after:previousIndex};
  if(previousIndex!==newIndex-1)throw Error('Real finger drag RIGHT must turn one page BACK: '+newIndex+' -> '+previousIndex);
  if(result.errors.length)throw Error('JavaScript errors while dragging: '+result.errors.join('; '));
  await page.locator('#back').click();
  if(!await page.locator('#hero').isVisible()||await page.locator('#reader').isVisible())throw Error('Back navigation failed');
  result.checks.return_to_library=true;
  // Regression: PageFlip used to destroy #book on back; the NEXT opening crashed
  // with "Cannot read properties of null (reading 'replaceChildren')".
  const reopenChecks=[];
  for(let cycle=0;cycle<3;cycle++){
   if(cycle===0)await page.locator('#featuredRead').click();
   else await page.locator('#library .tile button[aria-label$="읽기"]').first().click();
   await page.waitForFunction(()=>document.querySelector('#reader')?.style.display==='block'&&
      document.querySelector('#book')?.style.display==='block'&&document.querySelectorAll('#book .storyLeaf').length===active?.pages?.length&&
      flip&&flip.getCurrentPageIndex()===0,null,{timeout:65000});
   await page.locator('#book .storyLeaf img').first().evaluate(img=>img.decode());
   const check=await page.evaluate(()=>({
    bookHosts:document.querySelectorAll('#book').length,
    leaves:document.querySelectorAll('#book .storyLeaf').length,
    playing:!!track,
    current:flip.getCurrentPageIndex(),
    errorText:document.querySelector('#loading')?.textContent||'',
    firstImageLoaded:document.querySelector('#book .storyLeaf img')?.naturalWidth>0
   }));
   if(check.bookHosts!==1||check.leaves!==loaded.chapterCount||check.current!==0||!check.firstImageLoaded||
      check.errorText.includes('그림책을 열지 않았습니다'))throw Error('Reopen failed after back navigation: '+JSON.stringify(check));
   reopenChecks.push(check);
   await page.locator('#back').click();
   if(!await page.locator('#hero').isVisible())throw Error('Could not return after reopening '+cycle);
  }
  result.checks.reopen_after_back=reopenChecks;
  // The final dedicated leaf must show the story-specific parent lesson, never TTS.
  await page.locator('#featuredRead').click();
  await page.waitForFunction(()=>document.querySelector('#book')?.style.display==='block'&&
     document.querySelectorAll('#book .moralLeaf').length===1,null,{timeout:65000});
  const moral=await page.evaluate(()=>{
    const last=active.pages.length;flip.turnToPage(last);return {last,text:active.parent_moral};
  });
  await page.waitForTimeout(300);
  const lesson=await page.evaluate(()=>({
    index:flip.getCurrentPageIndex(),pageNumber:document.querySelector('#pageNumber').textContent,
    title:document.querySelector('.moralLeaf h3')?.textContent,
    moral:document.querySelector('.moralLeaf p')?.textContent,
    narrationStopped:track===null
  }));
  if(lesson.index!==moral.last||!lesson.pageNumber.includes('교훈')||lesson.title!=='오늘의 교훈'
     ||lesson.moral!==moral.text||!lesson.narrationStopped)
    throw Error('Parent lesson must be final page with no autoplay TTS: '+JSON.stringify(lesson));
  result.checks.parent_moral_last_page=lesson;
  // Test NEXT and PREVIOUS through the book gesture API, not hidden buttons.
  await page.evaluate(()=>{flip.turnToPage(0);playPage(0)});
  for(let n=1;n<=moral.last;n++){
    await page.evaluate(()=>turnOnePage(1));
    await page.waitForFunction(expected=>flip.getCurrentPageIndex()===expected,n,{timeout:3500});
    await page.waitForTimeout(1050); // Wait for curl to finish before the next gesture.
    const position=await page.evaluate(()=>flip.getCurrentPageIndex());
    if(position!==n)throw Error('NEXT button failed at '+n+': '+position);
  }
  if(await page.locator('#pageNext').isEnabled())throw Error('Next remains enabled past parent moral');
  for(let n=moral.last-1;n>=0;n--){
    await page.evaluate(()=>turnOnePage(-1));
    await page.waitForFunction(expected=>flip.getCurrentPageIndex()===expected,n,{timeout:3500});
    await page.waitForTimeout(1050); // Wait for curl to finish before the next gesture.
    const position=await page.evaluate(()=>flip.getCurrentPageIndex());
    if(position!==n)throw Error('PREVIOUS button failed at '+n+': '+position);
  }
  if(await page.locator('#pagePrev').isEnabled())throw Error('Previous remains enabled before scene 1');
  result.checks.complete_page_navigation={forward:moral.last,backward:moral.last};

  // Floating scroll buttons must move the viewport, never the book pages.
  await page.evaluate(()=>{window.scrollTo(0,0)});
  await page.waitForTimeout(200);
  if(!await page.locator('#scrollDown').isVisible()||!await page.locator('#scrollUp').isVisible())
    throw Error('Floating reader scroll controls missing');
  const beforeScroll=await page.evaluate(()=>({y:window.scrollY,index:flip.getCurrentPageIndex()}));
  const scrollTarget=await page.locator('#scrollDown').boundingBox();
  if(!scrollTarget||scrollTarget.width<44||scrollTarget.height<44)throw Error('Scroll button mobile touch target too small: '+JSON.stringify(scrollTarget));
  await page.locator('#scrollDown').click();
  await page.waitForTimeout(850);
  const afterScroll=await page.evaluate(()=>({y:window.scrollY,index:flip.getCurrentPageIndex()}));
  if(afterScroll.y<beforeScroll.y+60||afterScroll.y>beforeScroll.y+125||afterScroll.index!==beforeScroll.index)
    throw Error('Down scroll control did not scroll independently of the book: '+JSON.stringify({beforeScroll,afterScroll}));
  await page.locator('#scrollUp').click();
  await page.waitForTimeout(850);
  const upScroll=await page.evaluate(()=>window.scrollY);
  if(upScroll>=afterScroll.y-40)throw Error('Up scroll control did not move document upward');
  result.checks.separate_scroll_buttons={beforeScroll,afterScroll,upScroll};
  await page.locator('#back').click();
  if(await page.locator('#scrollDown').isVisible())throw Error('Scroll buttons remain visible after closing the book');
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
