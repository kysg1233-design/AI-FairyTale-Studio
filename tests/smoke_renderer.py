"""Offline two-cut FFmpeg integration smoke test without personal data or API keys."""
import importlib.util
import os
import subprocess
import tempfile
import wave
from pathlib import Path

os.environ.update(WORKER_URL="https://example.invalid", WORKER_JOB_KEY="test-only",
                  GEMINI_API_KEY="test-only", JOB_ID="123e4567-e89b-12d3-a456-426614174000")
spec=importlib.util.spec_from_file_location("renderer", Path("renderer/scripts/render.py"))
renderer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

def ff(*parts):
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",*map(str,parts)],
                   check=True,timeout=120)

with tempfile.TemporaryDirectory(prefix="studio-smoke-") as tmp:
    wd=Path(tmp)
    outputs=[]
    for i in range(2):
        video=wd/f"original{i}.mp4"
        opts=["-f","lavfi","-i","color=c=orange:s=360x640:r=15:d=1.1"]
        if i:
            opts+=["-f","lavfi","-i","sine=frequency=300:duration=1.1"]
        ff(*opts,"-c:v","libx264","-pix_fmt","yuv420p",
           *(["-c:a","aac"] if i else ["-an"]),"-shortest",video)
        wav=wd/f"voice{i}.wav"
        with wave.open(str(wav),"wb") as out:
            out.setnchannels(1);out.setsampwidth(2);out.setframerate(24000)
            out.writeframes(b"\\0\\0" * 24000 * 2)
        sub=wd/f"sub{i}.ass"
        renderer.captions(sub,"아주 따뜻한 밤이에요. 함께 이야기를 들어볼까요?",2.0)
        output=wd/f"cut{i}.mp4"
        renderer.render_cut(i,video,wav,sub,output,0.25,1.0)
        info=renderer.probe(output)
        types={x["codec_type"] for x in info["streams"]}
        assert "video" in types and "audio" in types
        assert renderer.duration(output)>=2.0
        outputs.append(output)
    manifest=wd/"list.txt"
    manifest.write_text("".join(f"file '{x}'\\n" for x in outputs),encoding="utf-8")
    final=wd/"final.mp4"
    ff("-f","concat","-safe","0","-i",manifest,"-c","copy",final)
    assert renderer.duration(final)>=4.0, "Both cuts must appear in final output"
    assert final.stat().st_size>10_000
    print("Offline 2-cut FFmpeg/TTS WAV/subtitle/mp4 integration PASS")
