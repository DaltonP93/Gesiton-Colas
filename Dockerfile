# syntax=docker/dockerfile:1.7
# Imagen única: API + frontend compilado servidos por el mismo proceso (puerto 3000).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build

FROM node:22-alpine AS runtime
# pg_dump / pg_restore / psql para las copias de seguridad, de la misma versión que la base de
# docker-compose (postgres:16). Si actualiza la base a otra versión, cambie también este paquete
# (postgresql17-client, postgresql18-client…): pg_dump no copia bases más nuevas que él.
RUN apk add --no-cache postgresql16-client
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @gc/api --workspace @gc/shared \
    && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data/uploads /data/backups && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/api/dist/index.js"]
