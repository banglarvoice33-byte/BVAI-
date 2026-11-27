# Render.com background worker: continuous
# Banglar Voice video render + upload + optional
# YouTube delivery.
# Production path when video must be MADE ON
# RENDER (not only GitHub Actions).
# Keep in sync with the root Dockerfile (same
# build steps).
FROM docker.io/library/node:22-bookworm-slim
# python3-pip is mandatory (pip3 is absent with
# only `python3` ); import check fails the build early
# if edge-tts is unusable.
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
# Bengali fonts are read from ../../frontend/public/
fonts by video-compose.mjs.
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

CMD ["bash", "scripts/pipeline/render-loop.sh"]
