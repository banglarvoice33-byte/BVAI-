"""Convert actual word VTT, or matched Edge cue VTT, to bounded ASS karaoke."""
import html
import re
import sys
from pathlib import Path


def parse_ts(value):
    match = re.match(r'^(\d+):(\d+):(\d+)[,.](\d+)', value.strip())
    if not match:
        raise ValueError('Unsupported VTT timestamp')
    h, m, s, fraction = match.groups()
    return int(h)*3600 + int(m)*60 + int(s) + int(fraction)/(10**len(fraction))


def fmt(value):
    cs = round(value*100)
    return f'{cs//360000}:{(cs//6000)%60:02d}:{(cs//100)%60:02d}.{cs%100:02d}'


def convert(text):
    words = []
    for block in re.split(r'\n\s*\n', text.strip()):
        lines = block.strip().splitlines()
        index = next((i for i, line in enumerate(lines) if '-->' in line), None)
        if index is None:
            continue
        a, b = lines[index].split('-->', 1)
        start, end = parse_ts(a), parse_ts(b)
        tokens = html.unescape(re.sub('<[^>]*>', '', ' '.join(lines[index+1:]))).split()
        if not tokens or end <= start:
            raise ValueError('Empty or invalid VTT cue')
        total = sum(map(len, tokens))
        cursor = start
        for i, token in enumerate(tokens):
            next_time = end if i == len(tokens)-1 else cursor+(end-start)*len(token)/total
            words.append((token,cursor,next_time))
            cursor = next_time
    if not words:
        raise ValueError('No subtitle words; refusing blank ASS')
    result = ['''[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Noto Sans Bengali,64,&H0000FFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text''']
    # Two-word groups. Retain pauses explicitly; never extend short words to 150 ms.
    for i in range(0,len(words),2):
        group = words[i:i+2]
        parts = []
        cursor = group[0][1]
        for word,start,end in group:
            gap = round((start-cursor)*100)
            if gap > 0:
                parts.append(f'{{\\k{gap}}}\\h')
            safe = word.replace('\\','').replace('{','').replace('}','')
            parts.append(f'{{\\kf{max(1,round((end-start)*100))}}}{safe}')
            cursor = end
        result.append(f"Dialogue: 0,{fmt(group[0][1])},{fmt(group[-1][2])},Karaoke,,0,0,0,,{' '.join(parts)}")
    return '\n'.join(result)+'\n'


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(convert(Path(sys.argv[1]).read_text(encoding='utf8')),encoding='utf8')
