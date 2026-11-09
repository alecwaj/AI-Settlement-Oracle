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

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY oracle/package.json oracle/
COPY demo/package.json demo/
RUN npm ci --workspace oracle --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/oracle/dist oracle/dist
WORKDIR /app/oracle
# Runs as root so it can open the dstack guest-agent socket mounted from the CVM host.
EXPOSE 3001
CMD ["node", "dist/server.js"]
