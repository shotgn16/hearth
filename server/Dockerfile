# Hearth server image — one image for everything that runs Hearth in a container:
#   docker compose (docker-compose.yml), the installers' "Install in Docker" option (ghcr.io/shotgn16/hearth),
#   and the Home Assistant add-on (ghcr.io/shotgn16/hearth-amd64 / -aarch64).
#
#   docker build -t hearth ./server            docker run -p 8484:8484 -v ./data:/data hearth
#
# Hearth's packages are pure JavaScript, so they're installed once on the build machine's own platform
# (no slow emulation) and copied onto the Node.js image for each target architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
ARG VERSION=dev
ARG BUILD_ARCH
LABEL io.hass.name="Hearth" io.hass.version="$VERSION" io.hass.type="addon" io.hass.arch="$BUILD_ARCH" \
      org.opencontainers.image.title="Hearth" \
      org.opencontainers.image.source="https://github.com/shotgn16/hearth" \
      org.opencontainers.image.description="Hearth household money manager" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"
RUN apk add --no-cache tzdata wget
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY web ./web
COPY scripts ./scripts
ENV NODE_ENV=production DATA_DIR=/data PORT=8484 TZ=Europe/London
VOLUME /data
EXPOSE 8484
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8484/api/status || exit 1
CMD ["node", "src/index.js"]
