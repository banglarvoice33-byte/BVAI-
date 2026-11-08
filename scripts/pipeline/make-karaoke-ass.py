import json, sys
# ব্যবহার: python3 make-karaoke-ass.py words.json out.ass
# words.json = [{"word":"বাংলাদেশে","start":0.2,"end":0.7}, ...] (edge-tts wordBoundary থেকে)
words = json.load(open(sys.argv[1]))
out = sys.argv[2]
header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, BorderStyle, Outline, Shadow
Style: Karaoke,Noto Sans Bengali,56,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,2,80,80,300,1,3,1

[Events]
Format: Layer, Start, End, Style, Text
"""
def fmt(t):
    cs = int(t*100)
    return f"{cs//360000}:{(cs//6000)%60:02d}:{(cs//100)%60:02d}.{cs%100:02d}"
lines = [header]
# 2 শব্দ করে এক লাইন
for i in range(0, len(words), 2):
    chunk = words[i:i+2]
    if not chunk: continue
    start = fmt(chunk[0]['start'])
    end = fmt(chunk[-1]['end'])
    text = ""
    for w in chunk:
        dur = max(1, int((w['end']-w['start'])*100))
        text += f"{{\\k{dur}}}{w['word']} "
    lines.append(f"Dialogue: 0,{start},{end},Karaoke,,0,0,0,,{text.strip()}")
open(out, 'w', encoding='utf-8').write("\n".join(lines))
print(f"ASS written: {out} ({len(words)} words)")
