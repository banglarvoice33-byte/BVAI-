import sys, os, requests
audio, out = sys.argv[1], sys.argv[2]
script_text = sys.argv[3] if len(sys.argv) > 3 else ""
key = os.environ.get("GROQ_API_KEY","")
r = requests.post(
  "https://api.groq.com/openai/v1/audio/transcriptions",
  headers={"Authorization": f"Bearer {key}"},
  files={"file": open(audio,'rb')},
  data={"model":"【entity-whisper¦canonical_name=Whisper】-large-v3-turbo","response_format":"verbose_json","language":"bn","timestamp_granularities[]":"word"},
  timeout=120,
)
j = r.json()
groq_words = j.get("words", [])
# Script words = correct spelling
script_words = script_text.strip().split() if script_text else [w["word"] for w in groq_words]
# Map: if counts match 1-1, else interpolate timing
vtt = "WEBVTT\n\n"
def fmt(x):
  h=int(x//3600); m=int((x%3600)//60); s=x%60
  return f"{h:02d}:{m:02d}:{s:06.3f}"
if len(script_words) == len(groq_words):
  pairs = list(zip(script_words, groq_words))
else:
  # Interpolate: distribute groq timestamps over script words
  pairs = []
  for i, sw in enumerate(script_words):
    gi = int(i * len(groq_words) / max(1, len(script_words)))
    gi = min(gi, len(groq_words)-1)
    pairs.append((sw, groq_words[gi]))
for sw, gw in pairs:
  vtt += f"{fmt(gw['start'])} --> {fmt(gw['end'])}\n{sw}\n\n"
open(out,'w',encoding='utf8').write(vtt)
print(f"groq whisper VTT: {len(pairs)} words, script-spelling + groq-timing")
