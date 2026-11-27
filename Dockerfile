FROM docker.io/library/node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg librsvg2-bin fontconfig fonts-noto-core \
  python3 python3-pip util-linux ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages edge-tts \
  && python3 -c "import edge_tts" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY scripts/pipeline/ ./scripts/pipeline/
COPY frontend/public/fonts/ ./frontend/public/fonts/
COPY run-bvai.sh ./run-bvai.sh

RUN chmod +x run-bvai.sh scripts/pipeline/render-loop.sh \
  && mkdir -p /app/temp_assets /app/logs \
  && chown -R node:node /app

ENV NODE_ENV=production \
  VIDEO_PUBLISH_MODE=distribute \
  VIDEO_DELIVERY_ENABLED=true \
  VIDEO_DELIVERY_PLATFORMS=youtube \
  RENDER_LOOP_INTERVAL_SEC=300

USER node
CMD ["bash", "scripts/pipeline/render-loop.sh"]
