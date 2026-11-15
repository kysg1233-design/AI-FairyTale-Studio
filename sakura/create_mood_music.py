#!/usr/bin/env python3
"""Produce five original, pre-rendered instrumental music beds for storybook scenes.

All notes and synthesis are original; no samples, third-party compositions or generated
streaming media. Every GitHub Pages build produces the exact same five MP3 tracks.
"""
import array, math, pathlib, subprocess, tempfile, wave
ROOT=pathlib.Path(__file__).resolve().parent
OUT=ROOT/"assets"
OUT.mkdir(parents=True,exist_ok=True)
SR=16000
DURATION=32
# Distinct modes, motifs, rhythms and accompaniment for actual story pacing.
THEMES={
 "calm":     {"scale":[261.63,293.66,329.63,392,440,523.25],"melody":[0,2,3,2,1,0,2,4,3,2,0,1,2,3,1,0],"beat":.88,"root":[261.63,329.63,392],"gain":.17},
 "joyful":   {"scale":[293.66,329.63,392,440,493.88,587.33],"melody":[0,2,4,5,3,2,4,5,4,3,1,2,3,4,2,0],"beat":.46,"root":[293.66,392,440],"gain":.15},
 "adventure":{"scale":[220,261.63,293.66,329.63,392,440],"melody":[0,2,3,5,4,2,0,3,4,5,3,2,4,3,1,0],"beat":.58,"root":[220,293.66,329.63],"gain":.16},
 "mystery":  {"scale":[220,246.94,261.63,329.63,369.99,440],"melody":[0,1,3,1,4,2,0,1,5,3,2,1,0,4,2,0],"beat":1.05,"root":[220,261.63,329.63],"gain":.11},
 "tender":   {"scale":[196,220,246.94,293.66,329.63,392],"melody":[3,2,1,0,1,3,4,3,2,1,0,2,3,1,0,0],"beat":.98,"root":[196,246.94,293.66],"gain":.13}
}
def render(name,theme):
    count=SR*DURATION
    out=array.array('h')
    beat=theme["beat"]
    scale=theme["scale"]
    melody=theme["melody"]
    root=theme["root"]
    for n in range(count):
        t=n/SR
        slot=int(t/beat)
        d=t-slot*beat
        f=scale[melody[slot%len(melody)]]
        env=min(1.,d/.035)*math.exp(-d*(1.85 if name=="joyful" else 1.35))
        bell=math.sin(2*math.pi*f*d)+.17*math.sin(4*math.pi*f*d)
        sound=.61*env*bell
        # A low, seamless chord pad; slower harmony than the melody.
        group=int(t/8)%4
        chord=root if group%2==0 else [root[0]*.75,root[1],root[2]]
        pad=sum(math.sin(2*math.pi*v*t+.1*math.sin(2*math.pi*.15*t))/3 for v in chord)
        sound+=.23*pad
        # A very soft, rhythmic pluck; never sharp enough to mask narration.
        if name in ("adventure","joyful"):
            step=t%(beat*2)
            if step<beat*.65:
                bass=root[0]/2
                sound+=.20*math.exp(-step*7)*math.sin(2*math.pi*bass*step)
        elif name=="mystery":
            sound+=.11*math.sin(2*math.pi*root[0]/2*t)*(.45+.55*math.sin(2*math.pi*.12*t)**2)
        fade=min(1.,t/1.0,(DURATION-t)/1.6)
        amp=max(-.94,min(.94,sound*theme["gain"]*fade))
        out.append(round(amp*32767))
    target=OUT/("sakura-lullaby.mp3" if name=="calm" else f"sakura-{name}.mp3")
    with tempfile.TemporaryDirectory() as temp:
        wav=pathlib.Path(temp)/f"{name}.wav"
        with wave.open(str(wav),"wb") as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes(out.tobytes())
        subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(wav),
                        "-codec:a","libmp3lame","-b:a","80k",str(target)],check=True)
    assert target.stat().st_size>80_000,(str(target),target.stat().st_size)
    print(name,"original instrumental",target.stat().st_size)
if __name__=="__main__":
    for name,theme in THEMES.items():render(name,theme)
