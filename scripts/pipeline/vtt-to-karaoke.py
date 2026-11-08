import re, sys
# ব্যবহার: python3 vtt-to-karaoke.py in.vtt out.ass
# edge-tts এর sentence-level VTT -> শব্দে শব্দে karaoke ASS
# শব্দের টাইমিং বাক্যের সময়কে শব্দের দৈর্ঘ্য অনুযায়ী ভাগ করে আনুমানিক করা হয়
def parse_ts(s):
    m = re.match(r'(\d+):(\d+):(\d+)[,.](\d+)', s.strip())
    h, mn, sec, ms = map(int, m.groups())
    return h*3600 + mn*60 + sec + ms/1000.0

text = open(sys.argv[1], encoding='utf-8').read()
blocks = re.split(r'\n\s*\n', text.strip())
words = []
for block in blocks:
    lines = [l.strip() for l in block.strip().splitlines() if l.strip()]
    ts_idx = next((i for i, l in enumerate(lines) if '-->' in l), None)
    if ts_idx is None:
        continue
    start_s, end_s = [p.strip() for p in lines[ts_idx].split('-->')]
    start, end = parse_ts(start_s), parse_ts(end_s)
    cue_words = ' '.join(lines[ts_idx+1:]).split()
    if not cue_words:
        continue
    total_chars = sum(len(w) for w in cue_words) or 1
    dur = max(0.3, end - start)
    t = start
    for w in cue_words:
        wdur = max(0.15, dur * len(w) / total_chars)
        words.append((w, t, t + wdur))
        t += wdur

def fmt(t):
    cs = int(round(t * 100))
    return f"{cs//360000}:{(cs//6000)%60:02d}:{(cs//100)%60:02d}.{cs%100:02d}"

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
out_lines = [header]
for i in range(0, len(words), 2):
    chunk = words[i:i+2]
    s, e = fmt(chunk[0][1]), fmt(chunk[-1][2])
    parts = []
    for (w, ws, we) in chunk:
        k = max(1, int(round((we - ws) * 100)))
        safe = w.replace('\\', '\\\\').replace('{', '\\{').replace('}', '\\}')
        parts.append(f"{{\\k{k}}}{safe}")
    out_lines.append(f"Dialogue: 0,{s},{e},Karaoke,,0,0,0,,{' '.join(parts)}")
open(sys.argv[2], 'w', encoding='utf-8').write("\n".join(out_lines))
print(f"karaoke ASS: {len(words)} words -> {sys.argv[2]}")
