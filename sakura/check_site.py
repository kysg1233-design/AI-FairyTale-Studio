#!/usr/bin/env python3
"""Offline release gate: refuse deployment of any advertised incomplete storybook."""
import json, pathlib, re, subprocess, tempfile, os, sys
root=pathlib.Path(__file__).resolve().parent
html=(root/"index.html").read_text("utf-8")
assert "generativelanguage.googleapis.com" not in html, "Reading page must not call Gemini"
assert "new St.PageFlip(" in html and "useMouseEvents:true" in html
assert "disableFlipByClick:true" in html
assert "async function prefetchBook" in html and "await prefetchBook(b" in html
assert "function playPage(" in html and "ctx.createBufferSource()" in html and "ctx.decodeAudioData(bytes)" in html
assert "id=\"narration\"" in html and "id=\"music\"" in html
assert "./assets/sakura-lullaby.mp3" in html and "./vendor/page-flip.browser.js" in html
assert "aria-pressed=\"true\"" in html
script=re.findall(r"<script>([\s\S]*?)</script>",html)
assert len(script)==1
with tempfile.NamedTemporaryFile("w",suffix=".js",delete=False,encoding="utf-8") as p:
    p.write(script[0])
    source=p.name
try: subprocess.run(["node","--check",source],check=True)
finally: os.unlink(source)
published=json.loads((root/"books/index.json").read_text("utf8")).get("books",[])
for b in published:
    assert b["status"]=="ready" and len(b["pages"])>=3 and b["source_url"].startswith("https://")
    assets=[b["cover"]]+[x for p in b["pages"] for x in (p["image"],p["audio"]["male"],p["audio"]["female"])]
    assert len(set(assets))==len(assets)-1 or len(set(assets))==len(assets) # cover may be first frame duplicated logically
    for rel in assets:
        assert re.fullmatch(r"books/[a-z0-9-]+/[A-Za-z0-9_.-]+",rel),rel
        f=root/rel
        assert f.is_file() and f.stat().st_size>=4000,str(f)
    for p in b["pages"]:
        assert re.search(r"[가-힣]",p["text"]) and p["heading"]
        assert p["audio"]["male"].endswith(".mp3") and p["audio"]["female"].endswith(".mp3")
print("PASS: static JS, no live generation, real drag flip, complete media catalog:",len(published),"books")
