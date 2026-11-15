#!/usr/bin/env python3
"""Create a separate Korean title narration in both voices for existing books.
Files are prepared and checked before the public catalog is updated.
"""
import json, pathlib, shutil, os, sys
from publish_weekly import BOOK_DIR, INDEX, create_audio, fail

def main():
    data=json.loads(INDEX.read_text("utf-8"))
    dirty=False
    for book in data.get("books",[]):
        if book.get("title_audio",{}).get("male") and book.get("title_audio",{}).get("female"):
            print("Title narration already available:",book["title"])
            continue
        slug=pathlib.Path(book["cover"]).parent.name
        stage=BOOK_DIR/"_staging"/slug
        stage.mkdir(parents=True,exist_ok=True)
        intro=book["title"]+". 오늘의 이야기를 시작할게요."
        for person in ("male","female"):
            out=stage/f"{person}-title.mp3"
            if out.is_file() and out.stat().st_size>4000:
                print("Reuse staged title:",book["title"],person)
                continue
            create_audio(intro,person,out)
            print("Created title narration:",book["title"],person)
        target=BOOK_DIR/slug
        if not target.is_dir():fail("Book asset folder missing: "+str(target))
        for person in ("male","female"):
            shutil.copyfile(stage/f"{person}-title.mp3",target/f"{person}-title.mp3")
        book["title_audio"]={person:f"books/{slug}/{person}-title.mp3" for person in ("male","female")}
        dirty=True
        print("Prepared both voice titles for",book["title"])
    if dirty:
        temporary=INDEX.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n","utf-8")
        temporary.replace(INDEX)
    print("Title narration preparation:", "updated" if dirty else "already current")

if __name__=="__main__":
    try: main()
    except Exception as e:
        print("TITLE AUDIO NOT PUBLISHED:",str(e),file=sys.stderr)
        sys.exit(1)
