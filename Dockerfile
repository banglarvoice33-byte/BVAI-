# Default Dockerfile at repo root for Render
# services that leave "Dockerfile Path" empty.
# Continuous Banglar Voice video render on
# Render.com (Background Worker recommended).
# Prefer explicit path deploy/
# video-renderer.Dockerfile in Render settings
# when possible.
FROM docker.io/library/node:22-bookworm-slim

# python3-pip is mandatory: installing only
# `python3` does NOT provide pip3 on Debian slim
# (that was the "pip3: not found / exit code 127"
# build failure). edge-tts is the keyless Bengali TTS
# fallback;
# the import check makes the build fail loudly here
# instead of at runtime ("No module named
# edge_tts").
RUN apt-get update && apt-get install -y
--no-install-recommends \
    ffmpeg librsvg2-bin fontconfig fonts-noto-core
python3 python3-pip util-linux ca-certificates \
    && pip3 install --no-cache-dir
--break-system-packages edge-tts \
    && python3 -c "import edge_tts" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
--no-audit --no-fund

COPY scripts/pipeline/ ./scripts/pipeline/
# video-compose.mjs resolves Bengali fonts
at ../../frontend/public/fonts relative to scripts/
pipeline;
# without this COPY, prepareFonts() throws
"Bundled Bengali fonts missing" on the first
render.
COPY frontend/public/fonts/ ./frontend/public/
fonts/
COPY run-bvai.sh ./run-bvai.sh

RUN chmod +x run-bvai.sh scripts/pipeline/
render-loop.sh \
    && mkdir -p /app/temp_assets /app/logs \
    && chown -R node:node /app

ENV NODE_ENV=production \
    VIDEO_PUBLISH_MODE=distribute \
    VIDEO_DISTRIBUTION_WORKER_ENABLED=false \
    VIDEO_DELIVERY_ENABLED=true \
    RENDER_LOOP_INTERVAL_SEC=300

USER node

# Long-running process. If the Render service is
(mis)typed as a Web Service, render-loop.sh
binds $PORT
# with a tiny health listener so the deploy is not
killed by the port scan.
CMD ["bash", "scripts/pipeline/render-loop.sh"]
