#!/usr/bin/env bash
# Same layout as render-sample.sh but captions go through libass (ASS subtitles), the path that
# shapes Bengali correctly. drawtext mis-orders pre-base vowel signs (ি, ে) and must NOT be used for Bengali.
# Usage: FONT=/path/to/bengali.ttf bash render-sample-ass.sh out.mp4
set -euo pipefail
OUT="${1:-sample-ass.mp4}"
FONT="${FONT:-/usr/share/fonts/truetype/freefont/FreeSans.ttf}"
[ -f "$FONT" ] || { echo "font not found: $FONT" >&2; exit 1; }
FONTDIR="$(dirname "$FONT")"
FAMILY="${FAMILY:-FreeSans}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/cap.ass" <<ASS
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,$FAMILY,58,&H00FFFFFF,&H99000000,&H99000000,0,0,0,0,100,100,0,0,3,14,0,2,60,60,300,1
Style: Source,$FAMILY,34,&HE6FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,3,40,40,110,1
Style: Symbolic,$FAMILY,30,&HD9FFFFFF,&H73000000,&H73000000,0,0,0,0,100,100,0,0,3,8,0,7,40,40,140,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:00.00,0:00:03.30,Caption,,0,0,0,,সকাল ৯টায় ৭৩ জন যাত্রী নিরাপদে পৌঁছেছেন
Dialogue: 0,0:00:03.30,0:00:06.60,Caption,,0,0,0,,ক্ষতিগ্রস্ত স্ত্রী ও শিশুদের উদ্ধার করা হয়েছে
Dialogue: 0,0:00:06.60,0:00:10.00,Caption,,0,0,0,,বিস্তারিত জানতে বাংলার ভয়েস ওয়েবসাইট দেখুন
Dialogue: 0,0:00:00.00,0:00:10.00,Source,,0,0,0,,সূত্র: রয়টার্স
Dialogue: 0,0:00:00.00,0:00:10.00,Symbolic,,0,0,0,,ছবি প্রতীকী
ASS

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "gradients=s=1080x1920:d=10:r=30:c0=0x16324f:c1=0x0b1d2e:x0=0:y0=0:x1=0:y1=1920" \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=10" \
  -filter_complex "[0:v]ass=$TMP/cap.ass:fontsdir=$FONTDIR,format=yuv420p[v];
    [1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 20 -r 30 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 -movflags +faststart -t 10 "$OUT"
echo "wrote $OUT"
