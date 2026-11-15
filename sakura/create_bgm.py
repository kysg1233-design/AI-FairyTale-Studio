#!/usr/bin/env python3
"""Deterministically compose original, soft bedtime background music as an MP3.
No third-party composition, melody, audio sample or licensed sound recording is used.
"""
import math, os, wave, array, pathlib, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parent
OUT=ROOT/"assets"/"sakura-lullaby.mp3"
OUT.parent.mkdir(parents=True,exist_ok=True)
SR=22050
DURATION=48.0
N=int(SR*DURATION)
# Original sparse 48-second pentatonic melody, tuned for comfortable background level.
sequence=[(0.20,392.0),(1.15,440.0),(2.35,523.25),(3.15,440.0),
 (4.70,392.0),(6.12,329.63),(7.22,293.66),(8.35,329.63),
 (9.60,392.0),(10.50,440.0),(11.70,392.0),(13.30,329.63),
 (14.65,293.66),(16.0,261.63),(17.5,329.63),(18.75,392.0),
 (20.15,440.0),(21.40,523.25),(22.8,587.33),(24.1,523.25),
 (25.7,440.0),(27.2,392.0),(28.6,329.63),(30.05,392.0),
 (31.4,440.0),(32.7,392.0),(34.35,349.23),(35.65,329.63),
 (37.0,293.66),(38.6,329.63),(40.0,261.63),(42.4,293.66),
 (44.2,261.63)]
pads=[(0,[261.63,329.63,392.0]),(12,[220.0,261.63,329.63]),
      (24,[174.61,220.0,261.63]),(36,[196.0,261.63,329.63])]
samples=array.array('h')
for index in range(N):
 t=index/SR
 fade=min(1.0,t/1.8,(DURATION-t)/2.5)
 sound=0.0
 for start,freq in sequence:
  d=t-start
  if 0<=d<2.35:
   attack=min(1.,d/.11)
   env=attack*math.exp(-d*1.28)
   # Soft music-box timbre with a lower octave and gently subdued upper harmonics.
   sound+=.085*env*(.75*math.sin(2*math.pi*freq*d)+.18*math.sin(2*math.pi*freq*2*d)+.07*math.sin(2*math.pi*freq*.5*d))
 for start,frequencies in pads:
  d=t-start
  if 0<=d<12.3:
   env=math.sin(math.pi*min(1,d/12.3))**1.8
   sound+=.014*env*sum(math.sin(2*math.pi*f*d)/len(frequencies) for f in frequencies)
 sound=max(-.95,min(.95,sound*fade))
 samples.append(int(sound*32767))
with tempfile.TemporaryDirectory() as tmp:
 wavfile=pathlib.Path(tmp)/"soft-lullaby.wav"
 with wave.open(str(wavfile),"wb") as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(samples.tobytes())
 subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(wavfile),"-codec:a","libmp3lame","-b:a","96k",str(OUT)],check=True)
assert OUT.stat().st_size>60_000
print("Original royalty-free bedtime background track:",OUT,OUT.stat().st_size)
