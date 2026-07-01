# syntax=docker/dockerfile:1
# OmniTenant backend — Express + Sequelize + TypeScript.
# src/server.ts runs pending migrations when NODE_ENV != "test".

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 api

COPY --from=build --chown=api:nodejs /app/package.json ./package.json
COPY --from=build --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=api:nodejs /app/dist ./dist

USER api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
