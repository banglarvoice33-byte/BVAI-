FROM docker.io/library/node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg librsvg2-bin fontconfig fonts-noto-core python3 util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages edge-tts

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY scripts/pipeline/ ./scripts/pipeline/
COPY run-bvai.sh ./run-bvai.sh

RUN chmod +x run-bvai.sh scripts/pipeline/render-loop.sh \
    && mkdir -p /app/temp_assets /app/logs \
    && chown -R node:node /app

CMD ["bash", "scripts/pipeline/render-loop.sh"]

