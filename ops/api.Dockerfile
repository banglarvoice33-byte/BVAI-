FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY ops/api ./api
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "api/server.mjs"]
