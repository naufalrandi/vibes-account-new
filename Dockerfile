# syntax=docker/dockerfile:1
# OmniTenant backend — Express + Sequelize + TypeScript.
# Runs the TS source via tsx so the .ts migrations resolve at boot
# (src/server.ts runs pending migrations when NODE_ENV != "test").
FROM node:22-alpine

WORKDIR /app

# Install ALL deps — tsx/typescript are needed at runtime to run the TS source.
COPY package.json package-lock.json* ./
RUN npm ci

# Application source
COPY . .

ENV NODE_ENV=production
ENV PORT=6100
EXPOSE 6100

# Boots the API; it applies pending migrations on startup.
CMD ["npx", "tsx", "src/server.ts"]
