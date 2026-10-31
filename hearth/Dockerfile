# Plain Docker build (docker compose / local). The Home Assistant add-on uses the ready-made image built from .github/docker/Dockerfile.addon.
ARG BUILD_FROM=node:22-alpine
FROM ${BUILD_FROM}
ARG BUILD_ARCH
ARG BUILD_VERSION=1.2.0

ENV NODE_ENV=production DATA_DIR=/data PORT=8484
RUN apk add --no-cache tzdata wget

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY scripts ./scripts

LABEL io.hass.name="Hearth" io.hass.type="app" io.hass.version="${BUILD_VERSION}" io.hass.arch="${BUILD_ARCH}"

EXPOSE 8484
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8484/api/status || exit 1
CMD ["node", "server/index.js"]
