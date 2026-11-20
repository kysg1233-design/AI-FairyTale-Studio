#!/usr/bin/env python3
"""Import complete prebuilt books; never calls Gemini or any generation API."""
import json, pathlib, re, shutil, hashlib, datetime
from PIL import Image
from mutagen.mp3 import MP3

ROOT=pathlib.Path(__file__).resolve().parent
INBOX=ROOT/"incoming"; BOOKS=ROOT/"books"; INDEX=BOOKS/"index.json"
MIN_BYTES=4000

def asset(folder,name):
    p=(folder/name).resolve()
    if folder.resolve() not in p.parents or not p.is_file() or p.stat().st_size<MIN_BYTES:
        raise ValueError(f"missing/unsafe/undersized asset: {name}")
    return p

def main():
    data=json.loads(INDEX.read_text("utf-8"))
    folders=sorted(p for p in INBOX.iterdir() if p.is_dir()) if INBOX.exists() else []
    added=0
    for folder in folders:
        m=json.loads((folder/"book.json").read_text("utf-8"))
        for k in ("title","region","source_title","source_url","source_credit","parent_moral","character_bible"):
            if not isinstance(m.get(k),str) or not m[k].strip(): raise ValueError(f"{folder.name}: {k} missing")
        if not m["source_url"].startswith("https://www.gutenberg.org/"): raise ValueError("unverified source URL")
        if len(m.get("pages",[]))!=6: raise ValueError(f"{folder.name}: exactly 6 pages required")
        if any((b.get("source_url"),b.get("source_title"))==(m["source_url"],m["source_title"]) for b in data["books"]):
            print("Already published:",m["title"]); continue
        slug=re.sub(r"[^a-z0-9-]+","-",folder.name.lower()).strip("-")
        dest=BOOKS/f"story-{slug}"
        if not slug or dest.exists(): raise ValueError(f"invalid or existing slug: {slug}")
        a=folder/"assets"; files={"cover.webp":asset(a,"cover.webp")}
        with Image.open(files["cover.webp"]) as im:
            if im.format!="WEBP" or min(im.size)<480: raise ValueError("invalid cover")
        hashes=set()
        for i,page in enumerate(m["pages"],1):
            if not page.get("heading") or len(page.get("text","").strip())<160: raise ValueError(f"page {i}: incomplete text")
            image=f"page-{i:02d}.webp"; files[image]=asset(a,image)
            with Image.open(files[image]) as im:
                if im.format!="WEBP" or min(im.size)<480: raise ValueError(f"invalid {image}")
            digest=hashlib.sha256(files[image].read_bytes()).hexdigest()
            if digest in hashes: raise ValueError("duplicate illustrations")
            hashes.add(digest)
            for voice in ("male","female"):
                name=f"{voice}-{i:02d}.mp3"; files[name]=asset(a,name)
                if MP3(files[name]).info.length<2: raise ValueError(f"short/invalid narration: {name}")
        for voice in ("male","female"):
            name=f"{voice}-title.mp3"; files[name]=asset(a,name)
            if MP3(files[name]).info.length<1: raise ValueError(f"short title narration: {name}")
        dest.mkdir(parents=True)
        for name,path in files.items(): shutil.copy2(path,dest/name)
        m["status"]="ready"; m["published_at"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
        m["cover"]=f"books/story-{slug}/cover.webp"
        m["title_audio"]={v:f"books/story-{slug}/{v}-title.mp3" for v in ("male","female")}
        for i,p in enumerate(m["pages"],1):
            p["image"]=f"books/story-{slug}/page-{i:02d}.webp"
            p["audio"]={v:f"books/story-{slug}/{v}-{i:02d}.mp3" for v in ("male","female")}
        (dest/"manifest.json").write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n","utf-8")
        data["books"].append(m); added+=1
        print(f"IMPORTED {m['title']}: 6 illustrations + 12 narration + 2 title audio + cover")
        if len([b for b in data["books"] if b.get("status")=="ready"])>=100: break
    if added: INDEX.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n","utf-8")
    print("Ready books:",sum(b.get("status")=="ready" for b in data["books"]),"new:",added)

if __name__=="__main__": main()
