#!/usr/bin/env python3
"""Render five clearly differentiated, original story-scene soundtracks.

Each theme has its own timbre, envelope, rhythm and accompaniment. No samples or
third-party compositions are used. Tracks are rendered ahead of time for reliable playback.
"""
import array, math, pathlib, subprocess, tempfile, wave
ROOT=pathlib.Path(__file__).resolve().parent
OUT=ROOT/"assets"
OUT.mkdir(parents=True,exist_ok=True)
SR=22050
DURATION=36
THEMES={
 "calm": {
  "scale":[261.63,293.66,329.63,392,440,523.25],
  "melody":[0,2,3,2,1,0,2,4,3,2,0,1,2,3,1,0],
  "beat":1.05,"root":[130.81,196.00,261.63],"gain":.19,
  "instrument":"harp","pulse":0.0
 },
 "joyful": {
  "scale":[293.66,329.63,392,440,493.88,587.33],
  "melody":[0,2,4,5,3,2,4,5,4,3,1,2,3,4,2,0],
  "beat":.36,"root":[146.83,196.00,293.66],"gain":.13,
  "instrument":"marimba","pulse":1.0
 },
 "adventure": {
  "scale":[220,261.63,293.66,329.63,392,440],
  "melody":[0,2,3,5,4,2,0,3,4,5,3,2,4,3,1,0],
  "beat":.52,"root":[110,164.81,220],"gain":.12,
  "instrument":"brass","pulse":1.0
 },
 "mystery": {
  "scale":[220,246.94,261.63,329.63,369.99,440],
  "melody":[0,1,3,1,4,2,0,1,5,3,2,1,0,4,2,0],
  "beat":1.28,"root":[110,164.81,220],"gain":.16,
  "instrument":"glass","pulse":0.0
 },
 "tender": {
  "scale":[196,220,246.94,293.66,329.63,392],
  "melody":[3,2,1,0,1,3,4,3,2,1,0,2,3,1,0,0],
  "beat":1.18,"root":[98,146.83,196],"gain":.15,
  "instrument":"strings","pulse":0.0
 }
}
def osc(freq,t,kind):
    phase=2*math.pi*freq*t
    if kind=="harp":
        return math.sin(phase)+.12*math.sin(2*phase)+.035*math.sin(3*phase)
    if kind=="marimba":
        return .72*math.sin(phase)+.23*math.sin(2.7*phase)+.05*math.sin(5.4*phase)
    if kind=="brass":
        return .55*math.sin(phase)+.28*math.sin(2*phase)+.12*math.sin(3*phase)+.05*math.sin(4*phase)
    if kind=="glass":
        return .58*math.sin(phase)+.29*math.sin(2.76*phase)+.13*math.sin(4.13*phase)
    # Warm bowed-string-like tone with a restrained vibrato.
    vibrato=math.sin(2*math.pi*5.1*t)*.003
    return .78*math.sin(phase+vibrato)+.17*math.sin(2*phase)+.05*math.sin(3*phase)
def render(name,theme):
    count=SR*DURATION
    out=array.array('h')
    beat=theme["beat"];scale=theme["scale"];melody=theme["melody"];root=theme["root"]
    instrument=theme["instrument"]
    for n in range(count):
        t=n/SR
        slot=int(t/beat);d=t-slot*beat
        freq=scale[melody[slot%len(melody)]]
        if instrument=="strings":
            env=min(1.,d/.30)*math.exp(-d*.72)
        elif instrument=="glass":
            env=min(1.,d/.025)*math.exp(-d*.72)
        elif instrument=="harp":
            env=min(1.,d/.025)*math.exp(-d*1.45)
        elif instrument=="marimba":
            env=min(1.,d/.008)*math.exp(-d*3.4)
        else:
            env=min(1.,d/.065)*math.exp(-d*1.0)
        sound=.52*env*osc(freq,d,instrument)
        # Chord beds are deliberately different in movement and harmonic colour.
        chord_index=int(t/(9 if name in ("calm","tender") else 6))%4
        chord=root if chord_index%2==0 else [root[0]*.75,root[1]*1.25,root[2]]
        if name=="calm":
            pad=sum(math.sin(2*math.pi*v*t)/3 for v in chord)
            sound+=.28*pad*(.75+.25*math.sin(2*math.pi*.08*t))
        elif name=="tender":
            pad=sum(math.sin(2*math.pi*v*t+.035*math.sin(2*math.pi*.18*t))/3 for v in chord)
            sound+=.34*pad
        elif name=="mystery":
            shimmer=sum(math.sin(2*math.pi*v*t*(1.002+i*.001))/3 for i,v in enumerate(chord))
            sound+=.18*shimmer*(.25+.75*(.5+.5*math.sin(2*math.pi*.11*t)))
            sound+=.045*math.sin(2*math.pi*root[0]*.5*t)
        elif name=="joyful":
            sound+=.12*sum(math.sin(2*math.pi*v*t)/3 for v in chord)
        else:
            sound+=.16*sum(math.sin(2*math.pi*v*t)/3 for v in chord)
        # Distinct soft rhythmic signatures: bouncing pizzicato vs. story-adventure pulse.
        if name=="joyful":
            step=t%(beat*2)
            if step<.11:
                sound+=.16*math.exp(-step*24)*math.sin(2*math.pi*(root[0]*1.5)*step)
            if d<.045:sound+=.045*math.sin(2*math.pi*1400*d)*math.exp(-d*42)
        elif name=="adventure":
            step=t%(beat*2)
            if step<.20:
                sound+=.23*math.exp(-step*13)*math.sin(2*math.pi*(root[0]*.5)*step)
            if d<.07:sound+=.065*math.sin(2*math.pi*95*d)*math.exp(-d*28)
        elif name=="mystery":
            sound+=.035*math.sin(2*math.pi*root[0]*.5*t)*(.5+.5*math.sin(2*math.pi*.09*t))
        fade=min(1.,t/1.4,(DURATION-t)/2.0)
        amp=max(-.92,min(.92,sound*theme["gain"]*fade))
        out.append(round(amp*32767))
    target=OUT/("sakura-lullaby.mp3" if name=="calm" else f"sakura-{name}.mp3")
    with tempfile.TemporaryDirectory() as temp:
        wav=pathlib.Path(temp)/f"{name}.wav"
        with wave.open(str(wav),"wb") as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes(out.tobytes())
        subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(wav),
                        "-codec:a","libmp3lame","-b:a","96k",str(target)],check=True)
    assert target.stat().st_size>80_000,(str(target),target.stat().st_size)
    print(name,"distinct original soundtrack",target.stat().st_size)
if __name__=="__main__":
    for name,theme in THEMES.items():render(name,theme)
