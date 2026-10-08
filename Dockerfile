# Game server image (§9): one Node process hosting many RunRooms.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
RUN pnpm install --frozen-lockfile --filter @dead-tracks/server...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @dead-tracks/server build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/server/dist ./dist
# The SQLite database and the JWT secret live here (mount a volume, §9).
RUN mkdir -p /app/data && chown node:node /app/data
ENV DATA_DIR=/app/data
USER node
EXPOSE 2567
CMD ["node", "--enable-source-maps", "dist/server.js"]
