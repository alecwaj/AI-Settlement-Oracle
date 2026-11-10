# Build context: repository root.  docker build -f oracle/Dockerfile -t ai-settlement-oracle .
# For a verifiable TEE deployment, pin the base image by digest and deploy the pushed image by digest:
# the dstack compose hash (measured into RTMR3) covers the compose file, so a digest-pinned image
# reference is what lets auditors tie the attestation to this exact source.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY oracle/package.json oracle/
COPY demo/package.json demo/
RUN npm ci --workspace oracle --include-workspace-root=false --ignore-scripts
COPY oracle/tsconfig.json oracle/
COPY oracle/src oracle/src
RUN npm run build --workspace oracle

# TEErminator: Confidential AI's verifying proxy. Pinned release + checksum so it is part of the measured image.
FROM debian:bookworm-slim AS teerminator
ARG TARGETARCH=amd64
ARG TEERMINATOR_VERSION=0.0.4
ARG TEERMINATOR_SHA256_amd64=d5573d3bb9c70f4f78d1f7f41f4b65bb0e0c406841e5f66eb8f4311c95d90253
ARG TEERMINATOR_SHA256_arm64=c3e5b2cd9414d8bcc1bdb311f8dc01437e4fede48cd023820430d110f146abcf
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    f="teerminator_${TEERMINATOR_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    curl -fsSL -o "/tmp/$f" "https://github.com/confidential-dot-ai/TEErminator/releases/download/v${TEERMINATOR_VERSION}/$f"; \
    if [ "$TARGETARCH" = "arm64" ]; then sum="$TEERMINATOR_SHA256_arm64"; else sum="$TEERMINATOR_SHA256_amd64"; fi; \
    echo "$sum  /tmp/$f" | sha256sum -c -; \
    tar -xzf "/tmp/$f" -C /tmp teerminator; \
    install -m 0755 /tmp/teerminator /usr/local/bin/teerminator

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY oracle/package.json oracle/
COPY demo/package.json demo/
RUN npm ci --workspace oracle --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/oracle/dist oracle/dist
COPY --from=teerminator /usr/local/bin/teerminator /usr/local/bin/teerminator
COPY oracle/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/oracle
ENV TEERMINATOR_BIN=/usr/local/bin/teerminator \
    CONFIDENTIAL_BASE_URL=http://127.0.0.1:8080/v1
# Runs as root so it can open the dstack guest-agent socket mounted from the CVM host.
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
