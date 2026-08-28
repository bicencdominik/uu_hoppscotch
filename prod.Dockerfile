# Base Go builder with Go lang installation
# This stage is used to build both Caddy and the webapp server,
# preventing vulnerable packages on the dependency chain
FROM alpine:3.24.1 AS go_builder
RUN apk add --no-cache curl git openssh-client

ARG TARGETARCH
ENV GOLANG_VERSION=1.26.5
# Download Go tarball
RUN case "${TARGETARCH}" in amd64) GOARCH=amd64 ;; arm64) GOARCH=arm64 ;; *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; esac && \
  curl -fsSL "https://go.dev/dl/go${GOLANG_VERSION}.linux-${GOARCH}.tar.gz" -o go.tar.gz
# Checksum verification of Go tarball
RUN case "${TARGETARCH}" in \
  amd64) expected="5c2c3b16caefa1d968a94c1daca04a7ca301a496d9b086e17ad77bb81393f053" ;; \
  arm64) expected="fe4789e92b1f33358680864bbe8704289e7bb5fc207d80623c308935bd696d49" ;; \
  esac && \
  actual=$(sha256sum go.tar.gz | cut -d' ' -f1) && \
  [ "$actual" = "$expected" ] && \
  echo "✅ Go Tarball Checksum OK" || \
  (echo "❌ Go Tarball Checksum failed! Expected: ${expected} Got: ${actual}" && exit 1)
# Install Go from verified tarball
RUN tar -C /usr/local -xzf go.tar.gz && rm go.tar.gz
# Set up Go environment variables
ENV PATH="/usr/local/go/bin:${PATH}" \
  GOPATH="/go" \
  GOBIN="/go/bin"



# Build Caddy from the Go base
FROM go_builder AS caddy_builder
RUN mkdir -p /tmp/caddy-build && \
  curl -fsSL -o /tmp/caddy-build/src.tar.gz https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_src.tar.gz
# Checksum verification of caddy source
RUN expected="e44e457ba3f2b5b8447952d2de0ae0a91b09d1a013e2521527e08b6f52acc9eb" && \
  actual=$(sha256sum /tmp/caddy-build/src.tar.gz | cut -d' ' -f1) && \
  [ "$actual" = "$expected" ] && \
  echo "✅ Caddy Source Checksum OK" || \
  (echo "❌ Caddy Source Checksum failed!" && exit 1)
WORKDIR /tmp/caddy-build
RUN tar -xzf /tmp/caddy-build/src.tar.gz && \
  # Fix GHSA-hrxh-6v49-42gf: upgrade grpc v1.82.1 (HIGH - DoS via crafted HTTP/2 request)
  go get google.golang.org/grpc@v1.82.1 && \
  # Fix CVE-2026-34986: upgrade go-jose v3 (HIGH - DoS via crafted JWE)
  go get github.com/go-jose/go-jose/v3@v3.0.5 && \
  # Clean up any existing vendor directory and regenerate with updated deps
  rm -rf vendor && \
  go mod tidy && \
  go mod vendor
WORKDIR /tmp/caddy-build/cmd/caddy
RUN go build



# Build webapp server from the Go base
# This reuses the Go installation from go_builder, avoiding a separate image pull
# and significantly reducing build time (especially on ARM64 in CI)
FROM go_builder AS webapp_server_builder
WORKDIR /usr/src/app
COPY . .
WORKDIR /usr/src/app/packages/hoppscotch-selfhost-web/webapp-server
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o webapp-server .



# Shared Node.js base with optimized NPM installation
FROM alpine:3.24.1 AS node_base
# Install dependencies
RUN apk upgrade --no-cache && \
  apk add --no-cache nodejs curl bash tini ca-certificates
# Set working directory for NPM installation
RUN mkdir -p /tmp/npm-install
WORKDIR /tmp/npm-install
# Download NPM tarball
RUN curl -fsSL https://registry.npmjs.org/npm/-/npm-11.18.0.tgz -o npm.tgz
# Verify checksum
RUN expected="73f6155215ebabf4ed96dca1f567c2372cc713c33af2e5b9b62fde4e92373e2e" \
  && actual=$(sha256sum npm.tgz | cut -d' ' -f1) \
  && [ "$actual" = "$expected" ] \
  && echo "✅ NPM Tarball Checksum OK" \
  || (echo "❌ NPM Tarball Checksum failed!" && exit 1)
# Install NPM from verified tarball and global packages
RUN tar -xzf npm.tgz && \
  cd package && \
  node bin/npm-cli.js install -g /tmp/npm-install/npm.tgz && \
  cd / && \
  rm -rf /tmp/npm-install
RUN mkdir -p /tmp/pnpm-install && cd /tmp/pnpm-install && \
  curl -fsSL https://registry.npmjs.org/pnpm/-/pnpm-10.34.2.tgz -o pnpm.tgz && \
  curl -fsSL https://registry.npmjs.org/@import-meta-env/cli/-/cli-0.7.4.tgz -o cli.tgz && \
  echo "06e0108a4941de2d709e1c3bc841d3e90c45c6a26cecac76f62044fa02cac1a0  pnpm.tgz" | sha256sum -c - && \
  echo "9edada700b616b4224ba69ce713e68c36e22cb2548be9134dd3af00c164d8ca0  cli.tgz" | sha256sum -c - && \
  npm install -g ./pnpm.tgz ./cli.tgz && \
  cd / && rm -rf /tmp/pnpm-install

# Fix CVE-2026-12151: replace vulnerable undici bundled in npm (ships 6.26.0, fix requires >=6.27.0)
RUN mkdir -p /tmp/undici-fix && \
  cd /tmp/undici-fix && \
  npm install undici@6.27.0 && \
  rm -rf /usr/lib/node_modules/npm/node_modules/undici && \
  cp -r node_modules/undici /usr/lib/node_modules/npm/node_modules/ && \
  rm -rf /tmp/undici-fix

# Fix CVE-2025-64756 by replacing vulnerable glob in @import-meta-env/cli (ships glob@11.0.2, fix requires >=11.1.0)
RUN mkdir -p /tmp/glob-fix && \
  cd /tmp/glob-fix && \
  npm install glob@11.1.0 && \
  rm -rf /usr/lib/node_modules/@import-meta-env/cli/node_modules/glob && \
  cp -r node_modules/glob /usr/lib/node_modules/@import-meta-env/cli/node_modules/ && \
  rm -rf /tmp/glob-fix

# Fix CVE: upgrade serialize-javascript in @import-meta-env/cli (ships 6.0.2, fix requires >=7.0.3)
RUN mkdir -p /tmp/serialize-fix && \
  cd /tmp/serialize-fix && \
  npm install serialize-javascript@7.0.7 && \
  rm -rf /usr/lib/node_modules/@import-meta-env/cli/node_modules/serialize-javascript && \
  cp -r node_modules/serialize-javascript /usr/lib/node_modules/@import-meta-env/cli/node_modules/ && \
  rm -rf /tmp/serialize-fix

# Fix CVE-2026-14257: brace-expansion <5.0.8 allows a DoS (unbounded expansion
# length → OOM crash). Every version below 5.0.8 is affected with no per-line
# backport, so replace all bundled/transitive copies (npm ships 5.0.7; the
# @import-meta-env/cli tree pulls an older copy) with the fixed 5.0.8.
RUN mkdir -p /tmp/brace-fix && \
  cd /tmp/brace-fix && \
  npm install brace-expansion@5.0.8 && \
  find /usr/lib/node_modules -type d -name brace-expansion -not -path '*/brace-fix/*' | \
    while read -r dir; do \
      rm -rf "$dir" && \
      cp -r /tmp/brace-fix/node_modules/brace-expansion "$dir"; \
    done && \
  rm -rf /tmp/brace-fix

# Fix multiple tar advisories (CVE-2026-59873 and the GHSA-r292-9mhp-454m family):
# every tar <7.5.22 is affected. Both the bundled npm (ships 7.5.19) and pnpm
# (ships 7.5.15) copies are vulnerable, so replace all bundled copies with the
# fixed 7.5.22. tar 7.5.x is a patch line (identical deps, pure JS), so the swap
# is a safe drop-in that keeps npm/pnpm working.
RUN mkdir -p /tmp/tar-fix && \
  cd /tmp/tar-fix && \
  npm install tar@7.5.22 && \
  find /usr/lib/node_modules -type d -path '*/node_modules/tar' -not -path '*/tar-fix/*' | \
    while read -r dir; do \
      rm -rf "$dir" && \
      cp -r /tmp/tar-fix/node_modules/tar "$dir"; \
    done && \
  rm -rf /tmp/tar-fix



FROM node_base AS base_builder
# Required by @hoppscotch/js-sandbox to build `isolated-vm`
RUN apk add --no-cache python3 make g++ git openssh-client zlib-dev brotli-dev c-ares-dev nghttp2-dev openssl-dev icu-dev ada-dev simdjson-dev simdutf-dev sqlite-dev zstd-dev

WORKDIR /usr/src/app
ENV HOPP_ALLOW_RUNTIME_ENV=true
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

COPY pnpm-lock.yaml .
RUN pnpm fetch

COPY . .
RUN pnpm install -f --prefer-offline



FROM base_builder AS backend_builder

WORKDIR /usr/src/app/packages/hoppscotch-backend
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN pnpm exec prisma generate
RUN pnpm run build
RUN pnpm --filter=hoppscotch-backend deploy /dist/backend --prod --legacy
WORKDIR /dist/backend
RUN pnpm exec prisma generate

FROM node_base AS backend
# Install caddy
COPY --from=caddy_builder /tmp/caddy-build/cmd/caddy/caddy /usr/bin/caddy
COPY --from=base_builder  /usr/src/app/packages/hoppscotch-backend/backend.Caddyfile /etc/caddy/backend.Caddyfile
COPY --from=backend_builder /dist/backend /dist/backend
COPY --from=base_builder /usr/src/app/packages/hoppscotch-backend/prod_run.mjs /dist/backend

# Remove the env file to avoid backend copying it in and using it
ENV PRODUCTION="true"
ENV PORT=8080

# Writable Caddy storage for non-root UIDs (no writable $HOME needed).
ENV XDG_DATA_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp

WORKDIR /dist/backend

CMD ["node", "prod_run.mjs"]
EXPOSE 80
EXPOSE 3170



FROM base_builder AS fe_builder
WORKDIR /usr/src/app/packages/hoppscotch-selfhost-web
# Upstream's build script hardcodes --max_old_space_size=8192. That caps only V8's
# old space; Rollup holds a lot of data outside the heap, so peak RSS lands well
# above 8 GB and this stage gets OOM-killed even on a Docker allocation of ~11 GB.
# A smaller cap makes V8 collect more aggressively and keeps total usage bounded.
# Raise it with --build-arg FE_BUILD_HEAP_MB=... if the build starts failing with
# "JavaScript heap out of memory" instead (that would be the opposite problem).
ARG FE_BUILD_HEAP_MB=4096
RUN node --max_old_space_size=${FE_BUILD_HEAP_MB} ./node_modules/vite/bin/vite.js build
# Group-writable (GID 0) so a non-root UID (OpenShift runs as GID 0) can rewrite
# these files during env injection. Done here (not in the runtime stage) so the
# perms travel with the COPY instead of duplicating the layer with a chmod there.
RUN chmod -R g=rwX /usr/src/app/packages/hoppscotch-selfhost-web/dist



FROM node_base AS app
# Install caddy
COPY --from=caddy_builder /tmp/caddy-build/cmd/caddy/caddy /usr/bin/caddy

# Copy over webapp server bin
COPY --from=webapp_server_builder /usr/src/app/packages/hoppscotch-selfhost-web/webapp-server/webapp-server /usr/local/bin/

COPY --from=fe_builder /usr/src/app/packages/hoppscotch-selfhost-web/prod_run.mjs /site/prod_run.mjs
COPY --from=fe_builder /usr/src/app/packages/hoppscotch-selfhost-web/selfhost-web.Caddyfile /etc/caddy/selfhost-web.Caddyfile
COPY --chown=root:0 --from=fe_builder /usr/src/app/packages/hoppscotch-selfhost-web/dist/ /site/selfhost-web

# Writable Caddy storage for non-root UIDs (no writable $HOME needed).
ENV XDG_DATA_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp

# Files keep g=rwX from the builder; only the COPY-created dirs need it. List the
# dirs (not /site/*) so the layer stays metadata-only and prod_run.mjs stays 755.
RUN chmod g=rwX /site /site/selfhost-web

# Pre-create /data group-writable so webapp-server's signing key persists across
# restarts under a non-root UID (else it's regenerated and logged each start).
RUN mkdir -p /data/webapp-server && chmod g=rwX /data /data/webapp-server

WORKDIR /site
# Run both webapp-server and Caddy after env processing (NOTE: env processing is required by both)
# An empty HOPP_ALTERNATE_PORT (compose passthrough of an undefined var) means unset,
# so the Caddyfile default (:80) applies.
CMD ["/bin/sh", "-c", "[ -n \"$HOPP_ALTERNATE_PORT\" ] || unset HOPP_ALTERNATE_PORT; node /site/prod_run.mjs && (webapp-server & caddy run --config /etc/caddy/selfhost-web.Caddyfile --adapter caddyfile)"]

EXPOSE 80
EXPOSE 3000
EXPOSE 3200



FROM base_builder AS sh_admin_builder
WORKDIR /usr/src/app/packages/hoppscotch-sh-admin
# Generate two builds for `sh-admin`, one based on subpath-access and the regular build
RUN pnpm run build --outDir dist-multiport-setup
RUN pnpm run build --outDir dist-subpath-access --base /admin/
# Group-writable (GID 0) so a non-root UID (OpenShift runs as GID 0) can rewrite
# these files during env injection. Done here (not in the runtime stage) so the
# perms travel with the COPY instead of duplicating the layer with a chmod there.
RUN chmod -R g=rwX dist-multiport-setup dist-subpath-access


FROM node_base AS sh_admin
# Install caddy
COPY --from=caddy_builder /tmp/caddy-build/cmd/caddy/caddy /usr/bin/caddy

COPY --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/prod_run.mjs /site/prod_run.mjs
COPY --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/sh-admin-multiport-setup.Caddyfile /etc/caddy/sh-admin-multiport-setup.Caddyfile
COPY --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/sh-admin-subpath-access.Caddyfile /etc/caddy/sh-admin-subpath-access.Caddyfile
COPY --chown=root:0 --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/dist-multiport-setup /site/sh-admin-multiport-setup
COPY --chown=root:0 --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/dist-subpath-access /site/sh-admin-subpath-access

# Writable Caddy storage for non-root UIDs (no writable $HOME needed).
ENV XDG_DATA_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp

# Files keep g=rwX from the builder; only the COPY-created dirs need it. List the
# dirs (not /site/*) so the layer stays metadata-only and prod_run.mjs stays 755.
RUN chmod g=rwX /site /site/sh-admin-multiport-setup /site/sh-admin-subpath-access

WORKDIR /site
CMD ["node","/site/prod_run.mjs"]

EXPOSE 80
EXPOSE 3100



FROM node_base AS aio

# Caddy install
COPY --from=caddy_builder /tmp/caddy-build/cmd/caddy/caddy /usr/bin/caddy

ENV PRODUCTION="true"
ENV PORT=8080

# Open Containers Initiative (OCI) labels - useful for bots like Renovate
LABEL org.opencontainers.image.source="https://github.com/hoppscotch/hoppscotch" \
  org.opencontainers.image.url="https://docs.hoppscotch.io" \
  org.opencontainers.image.licenses="MIT"

# Copy necessary files
# Backend files
COPY --from=base_builder /usr/src/app/packages/hoppscotch-backend/backend.Caddyfile /etc/caddy/backend.Caddyfile
COPY --from=backend_builder /dist/backend /dist/backend
COPY --from=base_builder /usr/src/app/packages/hoppscotch-backend/prod_run.mjs /dist/backend

# Static Server
COPY --from=webapp_server_builder /usr/src/app/packages/hoppscotch-selfhost-web/webapp-server/webapp-server /usr/local/bin/
COPY --chown=root:0 --from=fe_builder /usr/src/app/packages/hoppscotch-selfhost-web/dist /site/selfhost-web

# FE Files
COPY --from=base_builder /usr/src/app/aio_run.mjs /usr/src/app/aio_run.mjs
COPY --chown=root:0 --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/dist-multiport-setup /site/sh-admin-multiport-setup
COPY --chown=root:0 --from=sh_admin_builder /usr/src/app/packages/hoppscotch-sh-admin/dist-subpath-access /site/sh-admin-subpath-access
COPY aio-multiport-setup.Caddyfile /etc/caddy/aio-multiport-setup.Caddyfile
COPY aio-subpath-access.Caddyfile /etc/caddy/aio-subpath-access.Caddyfile

# Writable Caddy storage for non-root UIDs (no writable $HOME needed).
ENV XDG_DATA_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp

# Files keep g=rwX from the builders; only the COPY-created dirs need it. List the
# dirs (not /site/*) so the layer stays metadata-only.
RUN chmod g=rwX /site /site/selfhost-web /site/sh-admin-multiport-setup /site/sh-admin-subpath-access

# Pre-create /data group-writable so webapp-server's signing key persists across
# restarts under a non-root UID (else it's regenerated and logged each start).
RUN mkdir -p /data/webapp-server && chmod g=rwX /data /data/webapp-server

ENTRYPOINT [ "tini", "--" ]
COPY --chmod=755 healthcheck.sh /
HEALTHCHECK --interval=2s --start-period=15s CMD /bin/sh /healthcheck.sh

WORKDIR /dist/backend
CMD ["node", "/usr/src/app/aio_run.mjs"]

# NOTE: In subpath mode (ENABLE_SUBPATH_BASED_ACCESS=true) HOPP_ALTERNATE_PORT sets
#       Caddy's HTTP port (default 80). In multiport mode (default) Caddy uses the
#       fixed ports 3000/3100/3170 and it has no effect. Legacy
#       HOPP_AIO_ALTERNATE_PORT is still honoured.
EXPOSE 3170
EXPOSE 3000
EXPOSE 3100
EXPOSE 3200
EXPOSE 80



# Self-contained variant of `aio`: adds an embedded Postgres server, so the
# whole stack (DB + backend + frontend + admin dashboard + webapp-server) runs
# from a single container with no external database. Opt-in via
# HOPP_EMBEDDED_POSTGRES (set below); the plain `aio` target above is
# byte-for-byte unchanged by this stage.
FROM aio AS aio-standalone

# Alpine 3.24.1 has no postgresql15 package; 16 is the closest available and
# Prisma's migrations are plain SQL/DDL with no version-pinned features, so
# this is a safe deviation from the docker-compose dev setup's postgres:15.
# -contrib is required: the schema's full-text-search migration needs pg_trgm,
# which isn't in the base package.
RUN apk add --no-cache postgresql16 postgresql16-contrib su-exec

ENV HOPP_EMBEDDED_POSTGRES=true
ENV PGDATA=/data/postgres

# Parallels the existing /data/webapp-server convention above: a PVC/volume
# mounts over this path. Pre-chown to postgres:postgres (the apk package's
# uid/gid 70) for the default root-run case; g=rwX additionally covers running
# as an arbitrary non-root UID with GID 0 (already a supported mode for this
# image family -- see the HOPP_ALTERNATE_PORT note in .env.example).
RUN mkdir -p /data/postgres && chown -R postgres:postgres /data/postgres && chmod g=rwX /data /data/postgres

# Required embedded-DB credentials: HOPP_EMBEDDED_DB_PASSWORD (no default --
# aio_run.mjs fails fast if it's unset). Optional: HOPP_EMBEDDED_DB_USER
# (default hoppscotch), HOPP_EMBEDDED_DB_NAME (default hoppscotch). DATABASE_URL
# is derived from these at runtime; do not set it separately for this target.
