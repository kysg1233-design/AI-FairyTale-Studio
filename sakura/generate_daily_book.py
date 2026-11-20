#!/usr/bin/env python3
"""Generate one complete Korean picture book per run using local open-weight models.

No hosted inference endpoint, API key, or paid generation service is called.
Model weights and public-domain source texts are downloaded as ordinary files.
"""
from __future__ import annotations
import gc, hashlib, json, os, pathlib, re, shutil, subprocess, sys, unicodedata
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent
INBOX = ROOT / "incoming"
INDEX = ROOT / "books" / "index.json"
CANDIDATES = ROOT / "books" / "candidates.json"
MODEL_TEXT = "Qwen/Qwen2.5-3B-Instruct-GGUF"
MODEL_TEXT_FILE = "qwen2.5-3b-instruct-q4_k_m.gguf"
MODEL_IMAGE = "stable-diffusion-v1-5/stable-diffusion-v1-5"
TTS_REPO = "supertone-oss-archive/supertonic-3"
TTS_REVISION = "aafc6e32416a594460b32413efc49d7fe4ce6d46"
MOODS = {"calm", "joyful", "adventure", "mystery", "tender"}
STYLE = (
    "premium Korean children's picture book illustration, hand-painted gouache "
    "and watercolor, beautifully composed cinematic scene, expressive friendly "
    "characters, rich layered background, delicate brush texture, warm natural "
    "lighting, sophisticated color harmony, whimsical but believable, "
    "professional storybook art, no text, no letters, no watermark"
)
NEGATIVE = "text, letters, typography, watermark, logo, blurry, low quality, photorealistic, 3d render, extra limbs, malformed hands, duplicate character"

def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return re.sub(r"[^a-z0-9가-힣]+", "", value)

def read_json(path: pathlib.Path):
    return json.loads(path.read_text("utf-8"))

def choose_candidate(candidates, books):
    used_titles = {normalize(b.get("title", "")) for b in books}
    used_sources = {(b.get("source_url"), normalize(b.get("source_title", ""))) for b in books}
    for candidate in candidates:
        key = (candidate.get("source_url"), normalize(candidate.get("heading", "")))
        if normalize(candidate.get("title", "")) in used_titles or key in used_sources:
            continue
        if candidate.get("source_url", "").startswith("https://www.gutenberg.org/") and candidate.get("heading") and candidate.get("title"):
            yield candidate

def extract_story(candidate: dict) -> str:
    import requests
    from bs4 import BeautifulSoup
    response = requests.get(candidate["source_url"], timeout=35,
        headers={"User-Agent": "SakuraStorybook/1.0 (public-domain adaptation)"})
    response.raise_for_status()
    soup = BeautifulSoup(response.content, "html.parser")
    heading = normalize(candidate["heading"])
    matches = []
    for tag in soup.find_all(re.compile(r"^h[1-6]$")):
        if normalize(tag.get_text(" ", strip=True)) != heading:
            continue
        paragraphs = []
        for node in tag.find_all_next(["p", "h1", "h2", "h3", "h4", "h5", "h6"]):
            if node.name and node.name.startswith("h"):
                break
            value = " ".join(node.get_text(" ", strip=True).split())
            if value:
                paragraphs.append(value)
        excerpt = "\n".join(paragraphs)
        if len(excerpt) > 300:
            matches.append(excerpt)
    if matches:
        return max(matches, key=len)[:12000]
    body = soup.get_text("\n", strip=True)
    pos = body.casefold().find(candidate["heading"].casefold())
    if pos >= 0:
        excerpt = re.sub(r"\n{3,}", "\n\n", body[pos + len(candidate["heading"]):]).strip()
        if len(excerpt) > 300:
            return excerpt[:12000]
    raise ValueError(f"Could not isolate source chapter: {candidate['heading']}")

def parse_model_json(raw: str) -> dict:
    raw = raw.strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Local story model did not return a JSON object")
    return json.loads(raw[start:end + 1])

def validate_story(story: dict) -> None:
    pages = story.get("pages")
    if not isinstance(pages, list) or len(pages) != 6:
        raise ValueError("Story must contain exactly six illustrated pages")
    if len(story.get("character_bible", "").strip()) < 35:
        raise ValueError("Character design bible is missing")
    moral = story.get("parent_moral", "")
    if not 25 <= len(moral.strip()) <= 170:
        raise ValueError("Parent moral is outside the 25–170 character range")
    headings = set()
    for number, page in enumerate(pages, 1):
        heading, body, prompt = (str(page.get("heading", "")).strip(),
            str(page.get("text", "")).strip(), str(page.get("illustration_prompt", "")).strip())
        if len(heading) < 3 or heading in headings:
            raise ValueError(f"Page {number}: missing or duplicated heading")
        headings.add(heading)
        if not 160 <= len(body) <= 420 or not re.search(r"[가-힣]", body):
            raise ValueError(f"Page {number}: Korean story text must be 160–420 characters")
        if len(prompt) < 35:
            raise ValueError(f"Page {number}: illustration prompt is too short")
        if page.get("mood") not in MOODS:
            raise ValueError(f"Page {number}: unknown soundtrack mood")

def create_story(candidate: dict, source_excerpt: str) -> dict:
    from huggingface_hub import hf_hub_download
    from llama_cpp import Llama
    model_path = hf_hub_download(repo_id=MODEL_TEXT, filename=MODEL_TEXT_FILE)
    llm = Llama(model_path=model_path, n_ctx=8192, n_threads=4, n_batch=256,
        use_mmap=True, use_mlock=False, verbose=False)
    system = ("너는 어린이 그림책 전문 작가이자 편집자다. 원전의 핵심 사건과 결말을 "
        "충실히 살리되 4~8세 아이가 이해할 수 있는 자연스러운 한국어로 각색한다. "
        "짧은 요약이 아니라 장면·행동·대화·감정이 살아 있는 완결된 이야기로 쓴다. "
        "반드시 JSON만 출력한다.")
    user = f"""
아래 공개 원전의 한 이야기를 한국어 그림책으로 각색해라.
제목: {candidate['title']}
원전 제목: {candidate['heading']}
원전 출처: {candidate['source']}
원전 본문:
{source_excerpt[:10500]}

요구사항:
- 6개 페이지로 구성하고 시간 순서대로 사건이 충분히 전개되게 한다.
- 각 페이지 text는 공백 포함 한국어 180~300자. 한두 문장 요약 금지.
- 첫 페이지는 인물·장소·상황을 소개하고, 2~4페이지는 갈등과 행동을 충분히 보여주며,
  5페이지는 해결의 전환점, 6페이지는 원전 결말과 따뜻한 마무리를 담는다.
- 원전의 핵심 인물·사건·교훈을 바꾸거나 새 결말을 만들지 않는다.
- 캐릭터 외형을 character_bible에 구체적으로 기록해 모든 그림에서 일관되게 한다.
- illustration_prompt는 영어로 작성하고, 페이지마다 카메라 구도·표정·행동·배경을 구체화한다.
- 모든 illustration_prompt에 캐릭터 외형을 반복해 이미지 일관성을 높인다.
- 그림에 글자·말풍선·워터마크를 넣지 않는다.
- mood는 calm, joyful, adventure, mystery, tender 중 하나.
- parent_moral은 보호자가 아이에게 읽어줄 40~90자 교훈 문장.
- 원전에 없는 폭력·공포·차별적 표현은 완화하되 이야기의 인과관계는 유지한다.

JSON 스키마:
{{
 "character_bible":"한국어로 주요 인물 외형·복장·색상 묘사",
 "parent_moral":"보호자용 마무리 문장",
 "pages":[
  {{"heading":"짧은 페이지 제목","text":"180~300자 한국어 본문",
   "mood":"calm","illustration_prompt":"English visual prompt"}}
 ]
}}
"""
    try:
        result = llm.create_chat_completion(
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.72, top_p=0.88, max_tokens=3800,
            response_format={"type": "json_object"})
        story = parse_model_json(result["choices"][0]["message"]["content"])
    finally:
        del llm
        gc.collect()
    validate_story(story)
    return story

def generate_illustrations(story: dict, output_dir: pathlib.Path, seed: int):
    import torch
    from diffusers import DPMSolverMultistepScheduler, StableDiffusionPipeline
    torch.set_num_threads(4)
    pipe = StableDiffusionPipeline.from_pretrained(MODEL_IMAGE, torch_dtype=torch.float32,
        use_safetensors=True, safety_checker=None, requires_safety_checker=False)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
    pipe.enable_attention_slicing("max")
    pipe.enable_vae_slicing()
    pipe = pipe.to("cpu")
    pipe.set_progress_bar_config(disable=False)
    paths = []
    for index, page in enumerate(story["pages"], 1):
        prompt = (f"{STYLE}. Character design bible: {story['character_bible']}. "
            f"Scene {index} of the same coherent picture book: {page['illustration_prompt']}. "
            "Keep the exact same character faces, fur, hair, clothing and proportions "
            "as the other pages. Portrait children's book composition.")
        generator = torch.Generator(device="cpu").manual_seed(seed + index * 97)
        image = pipe(prompt=prompt, negative_prompt=NEGATIVE, width=512, height=768,
            num_inference_steps=18, guidance_scale=7.0, generator=generator).images[0]
        target = output_dir / f"page-{index:02d}.webp"
        image.save(target, "WEBP", quality=93, method=6)
        if target.stat().st_size < 4000:
            raise ValueError(f"Generated illustration {index} is unexpectedly small")
        paths.append(target)
        print(f"ILLUSTRATION {index}/6: {target.stat().st_size} bytes", flush=True)
    del pipe
    gc.collect()
    return paths

def synthesize_audio(story: dict, title: str, output_dir: pathlib.Path):
    import numpy as np
    import soundfile as sf
    from huggingface_hub import snapshot_download
    home = pathlib.Path(os.environ.get("SUPERTONIC_HOME", "/tmp/supertonic"))
    if not (home / "py" / "helper.py").is_file():
        raise FileNotFoundError("Pinned local Supertonic source is missing")
    model_dir = snapshot_download(repo_id=TTS_REPO, revision=TTS_REVISION,
        local_dir=os.environ.get("SUPERTONIC_ASSETS", "/tmp/supertonic-assets"))
    sys.path.insert(0, str(home / "py"))
    from helper import load_text_to_speech, load_voice_style
    assets = pathlib.Path(model_dir)
    tts = load_text_to_speech(str(assets / "onnx"), use_gpu=False)
    voices = {
        "male": load_voice_style([str(assets / "voice_styles" / "M1.json")]),
        "female": load_voice_style([str(assets / "voice_styles" / "F1.json")])}
    def save_audio(text: str, voice: str, name: str):
        wav, duration = tts(text, "ko", voices[voice], total_step=8, speed=0.98)
        length = max(1, int(tts.sample_rate * float(duration[0])))
        samples = np.asarray(wav[0, :length], dtype=np.float32)
        temp_wav, target_mp3 = output_dir / (name + ".wav"), output_dir / (name + ".mp3")
        sf.write(str(temp_wav), samples, tts.sample_rate)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(temp_wav),
            "-codec:a", "libmp3lame", "-b:a", "96k", str(target_mp3)], check=True)
        temp_wav.unlink(missing_ok=True)
        if target_mp3.stat().st_size < 4000:
            raise ValueError(f"Generated narration is too small: {target_mp3.name}")
    for voice in ("male", "female"):
        save_audio(f"오늘의 동화는 {title}입니다.", voice, f"{voice}-title")
        for index, page in enumerate(story["pages"], 1):
            save_audio(page["text"], voice, f"{voice}-{index:02d}")
            print(f"NARRATION {voice} {index}/6", flush=True)

def make_cover(page_image: pathlib.Path, title: str, target: pathlib.Path):
    from PIL import Image, ImageDraw, ImageFont
    image = Image.open(page_image).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((18, 535, 494, 744), radius=22, fill=(36, 22, 36, 178))
    font_path = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
    font = ImageFont.truetype(font_path, 42) if pathlib.Path(font_path).exists() else ImageFont.load_default()
    chars = list(title)
    lines = ["".join(chars[i:i + 9]) for i in range(0, len(chars), 9)]
    y = 575 if len(lines) <= 2 else 550
    for line in lines[:3]:
        draw.text((42, y), line, font=font, fill=(255, 247, 239, 255),
            stroke_width=1, stroke_fill=(65, 37, 54, 255))
        y += 54
    draw.text((42, 710), "SAKURA STORY THEATER",
        font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12),
        fill=(255, 226, 210, 255))
    Image.alpha_composite(image, overlay).convert("RGB").save(target, "WEBP", quality=93, method=6)

def main():
    books = read_json(INDEX).get("books", [])
    ready_count = sum(b.get("status") == "ready" for b in books)
    if ready_count >= 100:
        print("Catalogue reached the 100-book publishing cap; no generation needed.")
        return
    candidates = read_json(CANDIDATES)
    selected, source_text = None, None
    for candidate in choose_candidate(candidates, books):
        try:
            excerpt = extract_story(candidate)
            if len(excerpt) < 500:
                raise ValueError("Source excerpt is too short")
            selected, source_text = candidate, excerpt
            break
        except Exception as error:
            print(f"SKIP source {candidate.get('heading')}: {error}", flush=True)
    if selected is None:
        raise RuntimeError("No unused candidate has a verifiable source chapter")
    print("Selected public-domain source:", selected["heading"], flush=True)
    story = create_story(selected, source_text)
    date = datetime.now(timezone.utc).strftime("%Y%m%d")
    slug_hash = hashlib.sha256((selected["source_url"] + selected["heading"]).encode("utf-8")).hexdigest()[:10]
    package = INBOX / f"daily-{date}-{slug_hash}"
    if package.exists():
        shutil.rmtree(package)
    assets = package / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    seed = int(slug_hash[:8], 16)
    images = generate_illustrations(story, assets, seed)
    make_cover(images[0], selected["title"], assets / "cover.webp")
    home = pathlib.Path(os.environ.get("SUPERTONIC_HOME", "/tmp/supertonic"))
    if not (home / "py" / "helper.py").is_file():
        raise FileNotFoundError("Supertonic checkout missing; workflow must pin and clone it")
    synthesize_audio(story, selected["title"], assets)
    metadata = {
        "title": selected["title"], "region": selected["region"],
        "source_title": selected["heading"], "source_url": selected["source_url"],
        "source_credit": selected["source"], "parent_moral": story["parent_moral"],
        "character_bible": story["character_bible"],
        "pages": [{"heading": p["heading"], "text": p["text"], "mood": p["mood"]} for p in story["pages"]]
    }
    (package / "book.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"PACKAGE_READY {selected['title']} at {package}", flush=True)

if __name__ == "__main__":
    main()
