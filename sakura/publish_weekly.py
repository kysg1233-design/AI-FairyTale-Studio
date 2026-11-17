#!/usr/bin/env python3
"""Publish exactly one complete public-domain-based fairy-tale package per run.
Requires GEMINI_API_KEY in GitHub Actions secrets. Incomplete books never enter index.json.
No user API key is ever sent to the static website; all generation happens before publication.
"""
from __future__ import annotations
import os, sys, re, json, time, base64, wave, tempfile, shutil, subprocess, hashlib, io, pathlib, contextlib
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from bs4 import BeautifulSoup
from PIL import Image, ImageStat

ROOT=pathlib.Path(__file__).resolve().parent
BOOK_DIR=ROOT/"books"
QUEUE=BOOK_DIR/"candidates.json"
INDEX=BOOK_DIR/"index.json"
KEY=os.getenv("GEMINI_API_KEY","").strip()
TEXT_MODEL=os.getenv("GEMINI_TEXT_MODEL","gemini-3.8-flash")
IMAGE_MODEL=os.getenv("GEMINI_IMAGE_MODEL","gemini-3.1-flash-image")
VOICE_MODEL=os.getenv("GEMINI_VOICE_MODEL","gemini-3.8-flash-lite-tts")
BASE="https://generativelanguage.googleapis.com/v1beta/models/"
DEFAULT_PAGES=6
def fail(msg): raise RuntimeError(msg)
def slugify(s): return re.sub(r"[^a-z0-9-]+","-",s.lower()).strip("-")
def http_json(url,body=None,retries=4,extra_headers=None):
    headers={"User-Agent":"Sakura-StoryTheater/1.0 (+https://github.com/kysg1233-design/AI-FairyTale-Studio)","Content-Type":"application/json"}
    headers.update(extra_headers or {})
    raw=None if body is None else json.dumps(body,ensure_ascii=False).encode("utf-8")
    for attempt in range(retries):
        try:
            with urlopen(Request(url,data=raw,headers=headers),timeout=125) as r:
                response_text=r.read().decode("utf-8","replace")
                try:
                    return json.loads(response_text)
                except json.JSONDecodeError as e:
                    # Gemini occasionally returns a truncated JSON envelope (especially
                    # image responses). Retry the identical request instead of losing
                    # the entire book batch and its already-staged assets.
                    if attempt==retries-1:
                        fail(f"Malformed Gemini HTTP JSON after {retries} attempts: {e.msg} at char {e.pos}; response prefix={response_text[:180]!r}")
                    print(f"Malformed Gemini response JSON ({attempt+1}/{retries}); retrying: {e.msg} at char {e.pos}",flush=True)
        except HTTPError as e:
            msg=e.read().decode("utf8","replace")[:550]
            if e.code==429 and ("per_day" in msg or "per day" in msg or "daily" in msg.lower()):
                fail("Daily Gemini quota exceeded (HTTP 429). Already-produced scene media remain in a restartable staging folder.")
            if e.code not in (408,429,500,502,503,504) or attempt==retries-1: fail(f"HTTP {e.code}: {msg}")
        except (URLError, TimeoutError) as e:
            if attempt==retries-1: fail(f"Network error: {e}")
        time.sleep(min(25,3*(attempt+1)))
    fail("API retries exhausted")
def google(model,payload):
    if not KEY: fail("GEMINI_API_KEY secret not configured. Nothing published.")
    return http_json(BASE+model+":generateContent",payload,extra_headers={"x-goog-api-key":KEY})
def clean(t): return re.sub(r"\s+"," ",str(t)).strip()
def source_excerpt(candidate):
    """Retrieve the exact cited Gutenberg work, with independent URL and mirror fallbacks."""
    from urllib.parse import urlparse
    original=candidate["source_url"]
    parsed=urlparse(original)
    match=re.search(r"/(?:cache/epub|ebooks)/(\d+)",parsed.path)
    if parsed.hostname not in ("www.gutenberg.org","gutenberg.org") or not match:
        fail("Unapproved or unrecognized Project Gutenberg source URL")
    book_id=match.group(1)
    prefix="/".join(book_id[:-1])
    urls=list(dict.fromkeys([
        original,
        f"https://www.gutenberg.org/files/{book_id}/{book_id}-h/{book_id}-h.htm",
        f"https://www.gutenberg.org/ebooks/{book_id}.html.images",
        f"https://mirror.fi.ossplanet.net/gutenberg/{prefix}/{book_id}/{book_id}-h/{book_id}-h.htm",
    ]))
    allowed_hosts={"www.gutenberg.org","gutenberg.org","mirror.fi.ossplanet.net"}
    heading=clean(re.sub(r"[^a-z0-9]+"," ",str(candidate["heading"]).casefold()))
    last_error="no source URL succeeded"
    for source_url in urls:
        if urlparse(source_url).hostname not in allowed_hosts:
            continue
        html=None
        for attempt in range(3):
            try:
                request=Request(source_url,headers={
                    "User-Agent":"Mozilla/5.0 (compatible; Sakura-StoryTheater/1.0; +https://github.com/kysg1233-design/AI-FairyTale-Studio)",
                    "Accept":"text/html,application/xhtml+xml,*/*"
                })
                with urlopen(request,timeout=70) as response:
                    html=response.read(6_000_000).decode("utf-8","replace")
                break
            except HTTPError as e:
                last_error=f"HTTP {e.code} from {source_url}"
                if e.code not in (408,429,500,502,503,504):
                    break
                if attempt<2:
                    print(f"Source endpoint HTTP {e.code} ({attempt+1}/3); retrying {source_url}",flush=True)
                    time.sleep(3*(attempt+1))
            except (URLError,TimeoutError) as e:
                last_error=f"Network error from {source_url}: {e}"
                if attempt<2:
                    print(f"Source endpoint network error ({attempt+1}/3); retrying {source_url}: {e}",flush=True)
                    time.sleep(3*(attempt+1))
        if html is None:
            print(f"Source endpoint unavailable; trying independent fallback: {source_url} ({last_error})",flush=True)
            continue
        soup=BeautifulSoup(html,"html.parser")
        matches=[]
        for h in soup.find_all(re.compile("^h[1-6]$")):
            normalized=clean(re.sub(r"[^a-z0-9]+"," ",h.get_text(" ",strip=True).casefold()))
            if normalized==heading:
                matches.append(h)
        if not matches:
            last_error=f"Expected source heading not found at {source_url}"
            print(last_error+"; trying next verified copy",flush=True)
            continue
        h=matches[-1]
        fragments=[]
        for elem in h.next_elements:
            if fragments and getattr(elem,"name",None) and re.fullmatch("h[1-6]",elem.name):
                break
            if getattr(elem,"name",None)=="p":
                sentence=clean(elem.get_text(" ",strip=True))
                if len(sentence)>18:
                    fragments.append(sentence)
                if len(" ".join(fragments))>60_000:
                    break
        excerpt=" ".join(dict.fromkeys(fragments))
        if len(excerpt)>=170:
            print(f"Verified source retrieved from: {source_url}",flush=True)
            return excerpt[:60000]
        last_error=f"Source extract too short ({len(excerpt)}) at {source_url}"
        print(last_error+"; trying next verified copy",flush=True)
    fail(f"Could not retrieve exact source after official and mirror fallbacks: {last_error}")

def textual_prompt(item,excerpt):
    return (
      "당신은 어린이를 위한 한국어 옛이야기 작가입니다. 제공한 고전 원전만을 근거로 이야기의 "
      "원인-전개-해결을 충실히 유지하세요. 원전에 없는 인물/마법/반전을 추가하지 마세요. "
      "5세~8세가 이해할 수 있는 아름다운 한국어로 새롭게 각색하세요. "
      "기존 번역문을 문장 단위로 복제하지 마세요. 무섭거나 폭력적인 장면은 부드럽게 표현하세요. "
      f"정확히 {DEFAULT_PAGES}개 장면으로 나누고 1장면당 2~4문장, 대략 60~130 한국어 글자로 작성하세요. "
      "각 장면마다 그림용 scene_prompt를 영어로 자세하게 작성하고, character_bible은 등장인물의 "
      "얼굴/의상/체형/털색 등의 공통 고정값을 자세히 정의하세요. "
      "각 장면은 반드시 이전 장면과 시각적 구도, 장소 또는 행동이 달라야 합니다. "
      "각 장면에 mood를 반드시 하나 선택하세요: calm(평온), joyful(기쁨), adventure(모험), mystery(긴장·신비), tender(슬픔·따뜻한 위로). "
      "어린이에게 과도하게 무서운 음악은 사용하지 않으므로 사건의 감정을 과장하지 마세요. "
      "원전의 핵심 교훈을 담은 parent_moral 한 문단도 작성하세요. 부모가 아이에게 직접 읽어줄 말투로, "
      "어린이에게 따뜻하고 구체적이며 이해하기 쉬운 한국어 30~125자로 작성하세요. "
      "사건과 무관한 상투적 교훈이나 무리한 훈계를 금지합니다. "
      "아래 JSON 스키마 형태의 JSON 객체만 출력하세요. "
      '{"character_bible":"...","parent_moral":"부모가 읽어줄 한 문단의 교훈",'
      '"pages":[{"heading":"한국어 장면 제목","text":"동화 본문",'
      '"mood":"calm","scene_prompt":"English image direction"}]}. '
      f"\n제목: {item['title']}\n원전 제목: {item['heading']}\n원전 내용:\n{excerpt}"
    )
def story_plan(item,excerpt):
    out=google(TEXT_MODEL,{"contents":[{"parts":[{"text":textual_prompt(item,excerpt)}]}],
        "generationConfig":{"responseMimeType":"application/json","temperature":0.5,"maxOutputTokens":3400}})
    raw="".join(p.get("text","") for p in out.get("candidates",[{}])[0].get("content",{}).get("parts",[]))
    try: data=json.loads(raw)
    except Exception as e: fail(f"Story plan JSON malformed: {e} {raw[:200]}")
    pages=data.get("pages",[])
    if len(pages)!=DEFAULT_PAGES: fail(f"Expected {DEFAULT_PAGES} pages, received {len(pages)}")
    if len(data.get("character_bible",""))<35: fail("Character bible absent")
    prior=set()
    for p in pages:
        h=clean(p.get("heading"));t=clean(p.get("text"));art=clean(p.get("scene_prompt"))
        if not (4<=len(h)<=40 and 35<=len(t)<=240 and len(art)>60): fail("Page content length invalid")
        if len(re.findall("[가-힣]",t))<25 or re.search("[A-Za-z]{3,}",t): fail("Non-Korean narration detected")
        if t in prior: fail("Duplicate narration page")
        prior.add(t)
        mood=p.get("mood","calm")
        if mood not in ("calm","joyful","adventure","mystery","tender"):
            # Future model variants may omit mood: the browser has conservative text heuristics.
            mood="calm"
        p.update(heading=h,text=t,scene_prompt=art,mood=mood)
    # Plans saved from earlier interrupted batches may not contain the new field.
    return data
def ensure_parent_moral(plan):
    """Finish the parent-read closing page; never fail on one truncated JSON response."""
    moral=clean(plan.get("parent_moral",""))
    valid=lambda m: 30<=len(m)<=150 and len(re.findall("[가-힣]",m))>=20 and not re.search("[A-Za-z]{3,}",m)
    if not valid(moral):
        excerpts="\n".join(p["heading"]+": "+p["text"] for p in plan["pages"])
        instruction=(
            "다음 동화의 사건과 마지막 결말을 근거로 부모가 아이에게 직접 읽어주는 "
            "교훈 한 문단을 작성하세요. 한국어로 50~105자, 따뜻하고 구체적으로, "
            "이야기에 없는 내용을 덧붙이지 마세요. JSON 객체 형식으로 응답하세요. "
            '예시: {"parent_moral":"작은 친구의 도움도 소중해요. 서로를 존중하고 도와주어요."}' +
            "\n동화 본문:\n" + excerpts
        )
        failures=[]
        for attempt in range(3):
            output=google(TEXT_MODEL,{"contents":[{"parts":[{"text":instruction}]}],
                 "generationConfig":{"responseMimeType":"application/json","temperature":0.2,
                                     "maxOutputTokens":700+attempt*300}})
            raw="".join(p.get("text","") for p in output.get("candidates",[{}])[0].get("content",{}).get("parts",[]))
            try:
                parsed=json.loads(raw)
                moral=clean(parsed.get("parent_moral",""))
            except (ValueError,TypeError,AttributeError) as exc:
                failures.append(f"attempt {attempt+1}: {type(exc).__name__}")
                continue
            if valid(moral):
                break
            failures.append(f"attempt {attempt+1}: invalid moral")
    if not valid(moral):
        fail("Parent moral not generated after retries; preserve staged story: "+", ".join(failures))
    plan["parent_moral"]=moral
    return moral
def save_image(data,output):
    raw=base64.b64decode(data)
    with Image.open(io.BytesIO(raw)) as image:
        image=image.convert("RGB")
        if min(image.size)<480: fail(f"Image is too small: {image.size}")
        if ImageStat.Stat(image.resize((64,64))).stddev[0]<9: fail("Suspiciously flat image")
        image.save(output,"WEBP",quality=86,method=6)
        image.thumbnail((90,90))
        return image.copy()
def visual_difference(a,b):
    x=a.convert("L").resize((16,16));y=b.convert("L").resize((16,16))
    return sum(abs(k-v) for k,v in zip(x.getdata(),y.getdata()))/(256*255)
def image_generate(item,plan,i,outpath,reference=None):
    p=plan["pages"][i]
    message=(
      "Create a premium original children's storybook illustration, cinematic high-end 3D "
      "animation-quality lighting, richly detailed environment, tactile textures, warm "
      "expressive characters, sophisticated pastel color grading, landscape 4:3. "
      "Original art, do not mimic copyrighted film characters. NO TEXT, NO LETTERS. "
      "The same character designs MUST remain consistent throughout the series. "
      "Character design bible: "+plan["character_bible"]+
      ". Distinct scene "+str(i+1)+" out of "+str(DEFAULT_PAGES)+": "+p["scene_prompt"]+
      ". This is a specific separate event, not a repeated portrait."
    )
    parts=[{"text":message}]
    if reference is not None:
        if not reference.is_file(): fail("Image character reference missing")
        parts[0]["text"] += (
          " The attached preceding picture is a CHARACTER AND STYLE REFERENCE ONLY. "
          "Keep the character's facial structure, clothing, body proportions, colours and "
          "rendering style identical, but create the CURRENT scene as a clearly different "
          "composition, action and camera angle. Do not copy the earlier scene."
        )
        parts.append({"inlineData":{"mimeType":"image/webp",
                   "data":base64.b64encode(reference.read_bytes()).decode("ascii")}})
    data=google(IMAGE_MODEL,{"contents":[{"parts":parts}],
         "generationConfig":{"responseModalities":["IMAGE"]}})
    inline=next((p["inlineData"]["data"] for c in data.get("candidates",[]) for p in c.get("content",{}).get("parts",[]) if p.get("inlineData",{}).get("data")),None)
    if not inline: fail(f"No image generated at page {i+1}")
    return save_image(inline,outpath)
def create_audio(text,person,output):
    if re.search("[A-Za-z]",text) or len(re.findall("[가-힣]",text))<7:fail("Non-Korean or empty spoken narration")
    voice={"male":"Charon","female":"Leda"}[person]
    # IMPORTANT: no English prompting in the spoken contents; earlier version read it aloud.
    result=google(VOICE_MODEL,{"contents":[{"parts":[{"text":text}]}],
      "generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":voice}}}}})
    part=next((p["inlineData"] for c in result.get("candidates",[]) for p in c.get("content",{}).get("parts",[]) if p.get("inlineData",{}).get("data")),None)
    if not part:fail(f"Empty {person} audio")
    content=base64.b64decode(part["data"]);mime=part.get("mimeType","audio/L16;rate=24000")
    sample=int(re.search(r"rate=(\d+)",mime).group(1)) if re.search(r"rate=(\d+)",mime) else 24000
    temp=output.with_suffix(".wav")
    if "wav" in mime.lower():
        temp.write_bytes(content)
    elif ("L16" in mime or "pcm" in mime.lower() or "audio/" in mime):
        if len(content)%2: fail("PCM odd byte length")
        with wave.open(str(temp),"wb") as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(sample);w.writeframes(content)
    else: fail("Unexpected audio format: "+mime)
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(temp),"-codec:a","libmp3lame","-qscale:a","4",str(output)],check=True)
    temp.unlink()
    if output.stat().st_size<4000:fail(f"{person} MP3 suspiciously small")
    check=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(output)],capture_output=True,text=True,check=True)
    if float(check.stdout.strip())<2.0:fail(f"{person} audio too short")
def verify_package(path,meta):
    assets=[meta["cover"]]
    for p in meta["pages"]:assets.extend([p["image"],p["audio"]["male"],p["audio"]["female"]])
    if meta.get("title_audio"):assets.extend(meta["title_audio"].values())
    if len(assets)!=1+3*DEFAULT_PAGES+(2 if meta.get("title_audio") else 0):fail("Missing asset references")
    for rel in assets:
        filename=ROOT/rel
        if not filename.is_file() or filename.stat().st_size<4000:fail("Asset missing or invalid: "+rel)
    # images should differ by scene. Duplicate bytes signal broken repeat.
    checks=[hashlib.sha256((ROOT/p["image"]).read_bytes()).hexdigest() for p in meta["pages"]]
    if len(set(checks))!=len(checks):fail("Duplicate image files")
    if any(not p["audio"]["male"].endswith(".mp3") or not p["audio"]["female"].endswith(".mp3") for p in meta["pages"]):fail("Audio asset mismatch")
def publish_one():
    if not KEY: fail("Missing secret GEMINI_API_KEY. Add it under repository Settings → Secrets and variables → Actions.")
    candidates=json.loads(QUEUE.read_text("utf-8"))
    existing=json.loads(INDEX.read_text("utf-8")) if INDEX.exists() else {"books":[]}
    published={(b["source_url"],b["source_title"]) for b in existing.get("books",[]) if b.get("status")=="ready"}
    unpublished=[c for c in candidates if (c["source_url"],c["heading"]) not in published]
    if not unpublished:print("All candidates published");return
    # A failed candidate aborts the run. No incomplete or guessed books are published.
    counts={r:0 for r in dict.fromkeys(x['region'] for x in candidates)}
    for b in existing.get('books',[]):
        if b.get('status')=='ready':counts[b.get('region')]=counts.get(b.get('region'),0)+1
    # Begin with the Gutenberg Aesop chapter whose source heading has been independently verified.
    # Thereafter balance the catalogue across Korean, Japanese, European and Aesop stories.
    first=next((x for x in unpublished if x['heading']=='THE FOX AND THE GRAPES'),None)
    # The first launch should give readers several illustrated books, not a single title.
    # Prefer headings previously validated against Aesop; the weekly runs can expand into other regions.
    aesop_queue=['THE LION AND THE MOUSE','THE CROW AND THE PITCHER','THE TORTOISE AND THE HARE','THE FOX AND THE CROW','THE FOX AND THE GRAPES']
    preferred=next((x for heading in aesop_queue for x in unpublished if x['heading']==heading),None)
    c=first if not existing.get('books') and first else (preferred if len(existing.get('books',[]))<5 and preferred else min(unpublished,key=lambda x:(counts.get(x['region'],0),candidates.index(x))))
    slug="story-"+hashlib.sha256((c["source_url"]+"#"+c["heading"]).encode("utf-8")).hexdigest()[:12]
    destination=BOOK_DIR/slug
    if destination.exists():fail("Destination already exists; manual recovery required")
    print("Producing:",c["region"],c["title"],c["heading"])
    # Persist unfinished media across quota resets. The browser only reads verified books/index.json.
    staging=BOOK_DIR/"_staging"/slug
    staging.mkdir(parents=True,exist_ok=True)
    plan_file=staging/"story-plan.json"
    if plan_file.exists():
        plan=json.loads(plan_file.read_text("utf-8"))
        if len(plan.get("pages",[]))!=DEFAULT_PAGES:fail("Staged story plan is invalid")
        print("Resuming staged source-backed story:",c["title"])
    else:
        excerpt=source_excerpt(c)
        plan=story_plan(c,excerpt)
        plan_file.write_text(json.dumps(plan,ensure_ascii=False,indent=2),"utf-8")
    ensure_parent_moral(plan)
    plan_file.write_text(json.dumps(plan,ensure_ascii=False,indent=2),"utf-8")
    with contextlib.nullcontext(staging) as work:
        tmp=pathlib.Path(work)
        earlier=[]
        for i in range(DEFAULT_PAGES):
            p=plan["pages"][i];filename=tmp/f"page-{i+1:02d}.webp"
            if filename.is_file() and filename.stat().st_size>=4000:
                with Image.open(filename) as previously_generated:
                    small=previously_generated.convert("RGB")
                    small.thumbnail((90,90))
                print("Reused staged illustration",i+1)
            else:
                small=image_generate(c,plan,i,filename,tmp/f"page-{i:02d}.webp" if i else None)
            if any(visual_difference(small,prev)<0.045 for prev in earlier):fail("Too-similar adjacent illustration; refuse publication")
            earlier.append(small)
            for person in ("male","female"):
                recorded=tmp/f"{person}-{i+1:02d}.mp3"
                if recorded.is_file() and recorded.stat().st_size>=4000:
                    print("Reused staged",person,"narration",i+1)
                else:
                    create_audio(p["heading"]+". "+p["text"],person,recorded)
            print(f"Completed {i+1}/{DEFAULT_PAGES}: unique image, male voice, female voice")
        # Two pre-recorded book-title introductions; read before the first scene.
        for person in ("male","female"):
            audio=tmp/f"{person}-title.mp3"
            if not audio.is_file() or audio.stat().st_size<4000:
                create_audio(c["title"]+". 오늘의 이야기를 시작할게요.",person,audio)
        shutil.copyfile(tmp/"page-01.webp",tmp/"cover.webp")
        pages=[{"heading":p["heading"],"text":p["text"],"mood":p.get("mood","calm"),"image":f"books/{slug}/page-{i+1:02d}.webp",
                "audio":{"male":f"books/{slug}/male-{i+1:02d}.mp3","female":f"books/{slug}/female-{i+1:02d}.mp3"}}
               for i,p in enumerate(plan["pages"])]
        meta={"title":c["title"],"title_audio":{"male":f"books/{slug}/male-title.mp3","female":f"books/{slug}/female-title.mp3"},"region":c["region"],"source_title":c["heading"],"source_url":c["source_url"],
              "source_credit":c["source"],"status":"ready","published_at":datetime.now(timezone.utc).isoformat(),
              "cover":f"books/{slug}/cover.webp","parent_moral":plan["parent_moral"],"pages":pages}
        (tmp/"manifest.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2),"utf-8")
        shutil.copytree(tmp,destination,ignore=shutil.ignore_patterns("story-plan.json"))
        try: verify_package(destination,meta)
        except: shutil.rmtree(destination,ignore_errors=True);raise
        shutil.rmtree(staging,ignore_errors=True)
    existing["books"]=[*existing.get("books",[]),meta]
    # index updates LAST, after complete package validation.
    pending=INDEX.with_suffix(".json.tmp")
    pending.write_text(json.dumps(existing,ensure_ascii=False,indent=2),"utf-8")
    pending.replace(INDEX)
    print("SUCCESS: complete verified book published",slug)
if __name__=="__main__":
    existing_books=len(json.loads(INDEX.read_text("utf-8")).get("books",[])) if INDEX.exists() else 0
    # Publish one fully validated new storybook on every daily scheduled run, regardless of library size.
    target=1
    completed=0
    for n in range(target):
        before=len(json.loads(INDEX.read_text("utf-8")).get("books",[])) if INDEX.exists() else 0
        try:
            publish_one()
        except Exception as e:
            print(f"BOOK {n+1} OF {target} NOT PUBLISHED: {e}",file=sys.stderr)
            # Preserve verified books from previous iterations and proceed to public release.
            if completed==0:sys.exit(1)
            break
        after=len(json.loads(INDEX.read_text("utf-8")).get("books",[])) if INDEX.exists() else 0
        if after==before:break
        completed+=1
    print(f"BATCH RESULT: {completed} newly verified complete storybooks")
