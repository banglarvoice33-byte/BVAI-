FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ ./src/
RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
