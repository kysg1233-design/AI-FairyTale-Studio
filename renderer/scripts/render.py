#!/usr/bin/env python3
"""Private Actions renderer: fetch private R2 cuts, generate Korean TTS, burn captions, upload MP4.
Do not print narration, signed URLs or secrets. Job IDs are the only workflow inputs.
"""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import wave
from pathlib import Path

WORKER = os.environ["WORKER_URL"].rstrip("/")
SECRET = os.environ["WORKER_JOB_KEY"]
GEMINI_KEY = os.environ["GEMINI_API_KEY"]
JOB = os.environ["JOB_ID"]
if not re.fullmatch(r"[0-9a-f-]{36}", JOB):
    raise ValueError("Invalid job ID")

def fetch(url, method="GET", payload=None, headers=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(r, timeout=180) as x:
        return x.read()

def internal(suffix, method="GET", data=None):
    raw = fetch(WORKER + "/internal/jobs/" + JOB + suffix, method, data, {
        "Authorization": "Bearer " + SECRET,
        "Content-Type": "application/json",
    })
    return json.loads(raw)

def status(stage, detail="", value="running", percent=0):
    internal("/status", "POST", {"status": value, "stage": stage, "detail": detail, "percent": percent})

def run(cmd, timeout=2700):
    # Capture failures without ever printing the command or signed URLs.
    p = subprocess.run([str(x) for x in cmd], capture_output=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError("FFmpeg or upload command failed (exit " + str(p.returncode) + ")")

def probe(path):
    x = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                        "-of", "json", str(path)], capture_output=True, timeout=60)
    if x.returncode:
        raise RuntimeError("Uploaded video is not a valid media file")
    return json.loads(x.stdout)

def duration(path):
    return float(probe(path)["format"].get("duration") or 0)

def timestamp(seconds):
    cent = round(seconds * 100)
    h, rem = divmod(cent, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02}:{s:02}.{cs:02}"

def segments(text, size=23):
    text = re.sub(r"\s+", " ", text).strip()
    result = []
    for sentence in re.findall(r"[^.!?。！？]+[.!?。！？]?", text):
        buf = ""
        for word in sentence.strip().split():
            if len(buf) + len(word) + (1 if buf else 0) <= size:
                buf = (buf + " " + word).strip()
            else:
                if buf:
                    result.append(buf)
                while len(word) > size:
                    result.append(word[:size])
                    word = word[size:]
                buf = word
        if buf:
            result.append(buf)
    return result

def captions(path, text, spoken):
    chunks = segments(text)
    if not chunks:
        raise RuntimeError("Narration is missing")
    lines = [
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: 720",
        "PlayResY: 1280", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Story,Noto Sans CJK KR,43,&H00FFFFFF,&H00FFFFFF,&H99000000,&H99000000,1,0,0,0,100,100,0,0,1,3,1,2,52,52,238,1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    now = 0.08
    length = max(0.1, spoken - now)
    total = sum(max(1, len(c)) for c in chunks)
    for i, chunk in enumerate(chunks):
        end = spoken if i == len(chunks)-1 else now + length * len(chunk) / total
        cleaned = re.sub(r"[{}\\]", "", chunk).replace("\n", " ")
        lines.append(f"Dialogue: 0,{timestamp(now)},{timestamp(end)},Story,,0,0,0,,{cleaned}")
        total -= len(chunk)
        length -= end-now
        now = end
    path.write_text("\n".join(lines)+"\n", encoding="utf-8")

def speech(text, voice, output):
    prompt = ("한국어로 아빠가 아이에게 잠자리 동화를 읽어 주듯 따뜻하고 부드럽게, "
              "한 글자도 빠뜨리지 않고 다음 원고만 낭독해 주세요. 노래와 음악, 효과음은 넣지 마세요.\n"+text)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    reply = json.loads(fetch(url, "POST", payload, {
        "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY,
    }))
    parts = reply.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    data = next((p.get("inlineData") for p in parts if p.get("inlineData")), None)
    if not data or not data.get("data"):
        raise RuntimeError("Gemini TTS returned no audio")
    raw = base64.b64decode(data["data"])
    if len(raw)<2400:
        raise RuntimeError("Gemini TTS audio was too short")
    if raw.startswith(b"RIFF"):
        output.write_bytes(raw)
    else:
        with wave.open(str(output), "wb") as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(24000)
            f.writeframes(raw)
    if duration(output)<0.2:
        raise RuntimeError("Generated narration was empty")

def render_cut(index, input_path, voice_path, ass_path, output, bg, narration, quality="balanced"):
    info = probe(input_path)
    streams=info["streams"]
    if not any(s["codec_type"]=="video" for s in streams):
        raise RuntimeError("Cut has no video track")
    has_audio=any(s["codec_type"]=="audio" for s in streams)
    d=duration(input_path)
    voiced=duration(voice_path)
    if d<=0 or d>600:
        raise RuntimeError("Invalid source duration")
    target=max(d,voiced+0.4)
    args=["ffmpeg","-y","-hide_banner","-loglevel","error","-i",input_path,"-i",voice_path]
    if not has_audio:
        args+=["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]
    audio="0:a:0" if has_audio else "2:a:0"
    # Extend final video frame; preserve original sound without repeating it.
    width,height,fps=(480,854,20) if quality=="fast" else ((720,1280,24) if quality=="high" else (540,960,24))
    video=f"[0:v]fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,tpad=stop_mode=clone:stop_duration={target:.3f},trim=duration={target:.3f},setpts=PTS-STARTPTS,ass={ass_path}[v]"
    audio_bg=f"[{audio}]aresample=48000,volume={bg:.3f},afade=t=in:st=0:d=0.12,afade=t=out:st={max(0,d-0.15):.3f}:d=0.15,apad,atrim=duration={target:.3f},asetpts=PTS-STARTPTS[bg]"
    audio_voice=f"[1:a:0]aresample=48000,volume={narration:.3f},afade=t=in:st=0:d=0.035,afade=t=out:st={max(0,voiced-0.05):.3f}:d=0.05,apad,atrim=duration={target:.3f},asetpts=PTS-STARTPTS[vo]"
    args+=["-filter_complex",";".join([video,audio_bg,audio_voice,"[bg][vo]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.90:attack=5:release=80[a]"]),
           "-map","[v]","-map","[a]","-c:v","libx264","-preset","veryfast","-crf","24",
           "-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-ar","48000",
           "-ac","2","-movflags","+faststart","-t",f"{target:.3f}",output]
    run(args)
    if duration(output)+0.1<voiced:
        raise RuntimeError("Output ends before Korean narration")

def main():
    status("합성 작업 정보 확인 중")
    info=internal("/manifest")
    videos=info["videos"]
    count=info["cuts"]
    if not 1<=count==len(videos)<=20:
        raise RuntimeError("Video count mismatch")
    with tempfile.TemporaryDirectory(prefix="fairytale-") as tmp:
        wd=Path(tmp)
        completed=[]
        for i,v in enumerate(videos):
            status(f"컷 {i+1} / {count} 다운로드 중",percent=round(i*85/count))
            original=wd/f"source_{i:02d}.mp4"
            run(["curl","-fLsS","--max-time","1800","-o",original,v["sourceUrl"]],1900)
            status(f"컷 {i+1} / {count} 한국어 나레이션 생성 중",percent=round((i+.2)*85/count))
            voice=wd/f"voice_{i:02d}.wav"
            speech(v["narration"],info["voice"],voice)
            ass=wd/f"subtitle_{i:02d}.ass"
            captions(ass,v["narration"],duration(voice))
            status(f"컷 {i+1} / {count} 한국어 자막·배경음 합성 중",percent=round((i+.4)*85/count))
            out=wd/f"cut_{i:02d}.mp4"
            render_cut(i,original,voice,ass,out,info["backgroundVolume"],info["narrationVolume"],info.get("quality","balanced"))
            completed.append(out)
        status("최종 MP4 연결·검증 중",percent=88)
        playlist=wd/"list.txt"
        playlist.write_text("".join("file '"+str(path)+"'\n" for path in completed),encoding="utf-8")
        finished=wd/"final.mp4"
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","concat","-safe","0",
             "-i",playlist,"-c","copy","-movflags","+faststart",finished])
        final=probe(finished)
        types={s["codec_type"] for s in final["streams"]}
        if not finished.exists() or finished.stat().st_size<10000 or not {"video","audio"}<=types:
            raise RuntimeError("Final MP4 validation failed")
        status("완성 MP4 비공개 저장 중",percent=96)
        run(["curl","-fLsS","--max-time","1800","-X","PUT","-H","Content-Type: video/mp4",
             "-T",finished,info["outputUrl"]],1900)
        status("완료",f"{count}컷 영상과 한국어 나레이션·자막을 합쳤습니다.","complete",100)

if __name__=="__main__":
    try:
        main()
    except Exception as e:
        # Do not reveal URLs, story, or secrets to public logs.
        detail=type(e).__name__+": "+re.sub(r"https?://\S+","[private URL]",str(e))[:120]
        try:status("영상 합성 실패",detail,"failed")
        except Exception:pass
        print("Renderer error:",detail,file=sys.stderr)
        sys.exit(1)
