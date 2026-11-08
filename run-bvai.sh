#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
LOG="$HOME/bvai-render-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "╔════════════════════════════════════════╗"
echo "║  BVAI Termux Render Pipeline           ║"
echo "║  Started: $(date)                       ║"
echo "╚════════════════════════════════════════╝"
echo "📦 Checking packages..."
pkg install -y nodejs python python-pip ffmpeg librsvg fontconfig fontconfig-utils git curl 2>/dev/null || true
echo "🎙️  edge-tts..."
python -m pip install --quiet --break-system-packages edge-tts 2>/dev/null || true
echo "🔍 Verifying tools..."
for c in node npm ffmpeg ffprobe rsvg-convert edge-tts; do
  command -v "$c" >/dev/null 2>&1 || { echo "❌ Missing: $c"; exit 1; }
done
echo "✅ All tools available"
cd "$HOME/BVAI-fresh"
rm -rf temp_assets/
npm install @supabase/supabase-js --no-audit --no-fund 2>/dev/null || true
[ -f .env ] || { echo "❌ .env missing"; exit 1; }
set -a
source .env
set +a
: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"
echo "🎬 Rendering video..."
node scripts/pipeline/generate-video.js
echo "📤 Uploading to Supabase..."
if [ -f temp_assets/manifest.json ]; then
  node scripts/pipeline/upload-supabase-video.mjs
else
  echo "ℹ️ No manifest — skipping upload."
fi
rm -rf temp_assets/
echo "✅ Pipeline complete: $(date)"
echo "📋 Log: $LOG"
