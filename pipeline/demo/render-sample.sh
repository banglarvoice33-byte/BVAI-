#!/usr/bin/env bash
# Feasibility proof: renders a 10 s vertical news clip with the BVAI screen layout.
#   - 1080x1920, 30 fps, H.264 yuv420p, AAC 48 kHz stereo, faststart
#   - Bengali caption in the bottom safe area, shaped by harfbuzz (conjuncts stay joined)
#   - small source tag in the bottom-right corner
#   - audio mastered to about -14 LUFS / -1 dBTP (a 220 Hz tone stands in for the TTS voice-over)
# Usage: FONT=/path/to/bengali.ttf bash render-sample.sh out.mp4
# Termux: pkg install ffmpeg fontconfig; point FONT at any Bengali-capable .ttf (e.g. Noto Sans Bengali).
set -euo pipefail
OUT="${1:-sample.mp4}"
FONT="${FONT:-/usr/share/fonts/truetype/freefont/FreeSans.ttf}"
[ -f "$FONT" ] || { echo "font not found: $FONT" >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# caption = WRITTEN form (digits are fine on screen); the voice gets the SPOKEN form from bn-speech.mjs
printf '%s' 'সকাল ৯টায় ৭৩ জন যাত্রী নিরাপদে পৌঁছেছেন' > "$TMP/c1.txt"
printf '%s' 'ক্ষতিগ্রস্ত স্ত্রী ও শিশুদের উদ্ধার করা হয়েছে' > "$TMP/c2.txt"
printf '%s' 'বিস্তারিত জানতে বাংলার ভয়েস ওয়েবসাইট দেখুন' > "$TMP/c3.txt"
printf '%s' 'সূত্র: রয়টার্স' > "$TMP/src.txt"
printf '%s' 'ছবি প্রতীকী' > "$TMP/sym.txt"

CAP="fontfile=$FONT:fontsize=54:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=22:x=(w-text_w)/2:y=h-330"
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "gradients=s=1080x1920:d=10:r=30:c0=0x16324f:c1=0x0b1d2e:x0=0:y0=0:x1=0:y1=1920" \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=10" \
  -filter_complex "
    [0:v]drawtext=textfile=$TMP/c1.txt:$CAP:enable='between(t,0,3.3)',
         drawtext=textfile=$TMP/c2.txt:$CAP:enable='between(t,3.3,6.6)',
         drawtext=textfile=$TMP/c3.txt:$CAP:enable='between(t,6.6,10)',
         drawtext=textfile=$TMP/src.txt:fontfile=$FONT:fontsize=34:fontcolor=white@0.9:x=w-text_w-40:y=h-120,
         drawtext=textfile=$TMP/sym.txt:fontfile=$FONT:fontsize=30:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=10:x=40:y=140,
         format=yuv420p[v];
    [1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 20 -r 30 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 -movflags +faststart -t 10 "$OUT"
echo "wrote $OUT"
