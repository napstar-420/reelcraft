# syntax=docker/dockerfile:1.7
#
# Self-hosted Reelcraft: one container running the API + web app, Postgres,
# MinIO and Inngest under s6-overlay, with everything durable under /data.
# Build from the repo root:
#   docker build -f docker/app/Dockerfile -t reelcraft:dev .

ARG NODE_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=ubuntu:24.04
ARG GO_IMAGE=golang:1.24-bookworm
ARG INNGEST_VERSION=v1.45.1

# ---------------------------------------------------------------------------
# MinIO only ships source now, so build a pinned commit. The pseudo-version is
# checked against the Go checksum database, which keeps this reproducible.
FROM ${GO_IMAGE} AS minio
ARG MINIO_VERSION=v0.0.0-20260212201848-7aac2a2c5b7c
RUN CGO_ENABLED=0 GOTOOLCHAIN=auto \
    go install -trimpath -ldflags "-s -w" github.com/minio/minio@${MINIO_VERSION}

FROM inngest/inngest:${INNGEST_VERSION} AS inngest

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @reelcraft/shared build \
 && pnpm --filter @reelcraft/api build \
 && pnpm --filter @reelcraft/render-worker build \
 && pnpm --filter @reelcraft/web build
# Production dependencies only, for the processes that run in the container
# (the web app ships as static files).
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
 && pnpm install --frozen-lockfile --prod --offline \
      --filter @reelcraft/api... --filter @reelcraft/render-worker...

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS node

# Ubuntu 24.04 ships Postgres 16 in its main archive, so the database major
# version is pinned for the release's lifetime and patched by Ubuntu.
FROM ${RUNTIME_IMAGE} AS runtime
ARG TARGETARCH
ARG S6_OVERLAY_VERSION=3.2.1.0
ARG CODEX_VERSION=0.159.3
ARG REELCRAFT_VERSION=dev
ENV DEBIAN_FRONTEND=noninteractive

# FFmpeg, Chrome Headless Shell's system libraries, and Postgres 16. The
# packaged cluster is skipped: the database lives in /data.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl openssl xz-utils ffmpeg postgresql-common \
      libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
      libpango-1.0-0 libcairo2 libcups2t64 fonts-liberation \
 && echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf \
 && apt-get install -y --no-install-recommends postgresql-16 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version

RUN case "${TARGETARCH:-amd64}" in \
      amd64) s6arch=x86_64 ;; \
      arm64) s6arch=aarch64 ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}" \
 && curl -fsSL "${base}/s6-overlay-noarch.tar.xz" | tar -C / -Jxp \
 && curl -fsSL "${base}/s6-overlay-${s6arch}.tar.xz" | tar -C / -Jxp

RUN npm install -g "@openai/codex@${CODEX_VERSION}" && npm cache clean --force

COPY --from=minio /go/bin/minio /usr/local/bin/minio
COPY --from=inngest /usr/bin/inngest /usr/local/bin/inngest

RUN useradd --system --uid 10001 --user-group --create-home --home-dir /home/reelcraft reelcraft

ENV REELCRAFT_APP_DIR=/opt/reelcraft/app
COPY --from=build /src/package.json /src/pnpm-workspace.yaml ${REELCRAFT_APP_DIR}/
COPY --from=build /src/node_modules ${REELCRAFT_APP_DIR}/node_modules
COPY --from=build /src/packages ${REELCRAFT_APP_DIR}/packages
COPY --from=build /src/apps/api/package.json ${REELCRAFT_APP_DIR}/apps/api/
COPY --from=build /src/apps/api/dist ${REELCRAFT_APP_DIR}/apps/api/dist
COPY --from=build /src/apps/api/drizzle ${REELCRAFT_APP_DIR}/apps/api/drizzle
COPY --from=build /src/apps/api/node_modules ${REELCRAFT_APP_DIR}/apps/api/node_modules
COPY --from=build /src/apps/render-worker/package.json ${REELCRAFT_APP_DIR}/apps/render-worker/
COPY --from=build /src/apps/render-worker/dist ${REELCRAFT_APP_DIR}/apps/render-worker/dist
COPY --from=build /src/apps/render-worker/node_modules ${REELCRAFT_APP_DIR}/apps/render-worker/node_modules
COPY --from=build /src/apps/web/dist ${REELCRAFT_APP_DIR}/apps/web/dist

# Remotion looks for its browser relative to the working directory, and render
# jobs run in per-job folders, so install it once and point at it explicitly.
# Its webpack bundle cache lives beside the render worker and must be writable.
RUN mkdir -p /opt/remotion && cd /opt/remotion \
 && node -e "require('${REELCRAFT_APP_DIR}/apps/render-worker/node_modules/@remotion/renderer').ensureBrowser().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })" \
 && ln -s "$(find /opt/remotion/.remotion -type f -name chrome-headless-shell | head -1)" /usr/local/bin/chrome-headless-shell \
 && /usr/local/bin/chrome-headless-shell --version \
 && install -d -o reelcraft -g reelcraft "${REELCRAFT_APP_DIR}/apps/render-worker/node_modules/.cache"

COPY docker/app/rootfs/ /

ENV PATH=/usr/lib/postgresql/16/bin:${PATH} \
    NODE_ENV=production \
    REELCRAFT_VERSION=${REELCRAFT_VERSION} \
    API_PORT=8080 \
    WEB_DIST_DIR=${REELCRAFT_APP_DIR}/apps/web/dist \
    S3_ENDPOINT=http://127.0.0.1:9000 \
    S3_BROWSER_PATH_PREFIX=/storage \
    INNGEST_BASE_URL=http://127.0.0.1:8288 \
    WORKSPACE_ROOT=/data/workspace \
    CODEX_HOME=/data/codex \
    CODEX_BROWSER_OS_URL=http://host.docker.internal:9010/mcp \
    REMOTION_BROWSER_EXECUTABLE=/usr/local/bin/chrome-headless-shell \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=20000 \
    S6_KILL_GRACETIME=5000

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/api/system/health" || exit 1

ENTRYPOINT ["/init"]
