FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/next.config.ts ./
COPY docker-entrypoint-web.sh docker-entrypoint-worker.sh ./
RUN chmod +x docker-entrypoint-web.sh docker-entrypoint-worker.sh \
  && mkdir -p public/uploads \
  && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["./docker-entrypoint-web.sh"]
