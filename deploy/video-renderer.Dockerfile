# Linux render worker only. Vercel serves Next.js; Cloudflare handles edge routing/WAF.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
 ffmpeg librsvg2-bin fontconfig fonts-noto-core python3 util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts/pipeline/ ./scripts/pipeline/
COPY run-bvai.sh ./run-bvai.sh
RUN mkdir -p /app/temp_assets /app/logs && chown -R node:node /app
ENV NODE_ENV=production VIDEO_PUBLISH_MODE=review VIDEO_DISTRIBUTION_WORKER_ENABLED=false
USER node
CMD ["bash","run-bvai.sh"]
