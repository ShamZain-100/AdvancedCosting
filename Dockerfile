# syntax=docker/dockerfile:1
# One file, two images:  docker build --target api .   and   docker build --target web --build-arg NEXT_PUBLIC_API_URL=/api .

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# Download pnpm once, with retries: a flaky connection to the npm registry otherwise fails the whole build here.
# (Keep this version equal to "packageManager" in package.json.)
RUN for i in 1 2 3 4 5 6 7 8; do corepack prepare pnpm@11.21.0 --activate && exit 0; echo "pnpm download failed (attempt $i), retrying in 20 s"; sleep 20; done; exit 1
WORKDIR /app

# ── dependencies (cached until a manifest changes)
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/validators/package.json packages/validators/
COPY packages/config/package.json packages/config/
COPY packages/costing-engine/package.json packages/costing-engine/
COPY packages/ui/package.json packages/ui/
# Slow or flaky connections: long timeouts, many retries, fewer parallel requests. The cache mount keeps already
# downloaded packages between attempts, so a failed install resumes instead of starting from zero.
ENV pnpm_config_fetch_timeout=900000 pnpm_config_fetch_retries=10 pnpm_config_fetch_retry_mintimeout=20000 pnpm_config_network_concurrency=6
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

# ── build everything once
FROM deps AS build
COPY . .
RUN pnpm exec prisma generate --schema prisma/schema.prisma
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec turbo run build

# ── API production dependencies: a fresh install of only what the API needs at runtime (same lockfile, same
#    versions; no web app, no build or test tools). The Prisma client generated in the build stage is copied in.
FROM base AS api-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/validators/package.json packages/validators/
COPY packages/config/package.json packages/config/
COPY packages/costing-engine/package.json packages/costing-engine/
ENV pnpm_config_fetch_timeout=900000 pnpm_config_fetch_retries=10 pnpm_config_fetch_retry_mintimeout=20000 pnpm_config_network_concurrency=6
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    CI=true pnpm install --prod --frozen-lockfile --store-dir /pnpm-store --filter @costing/api...
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /tmp/.prisma
RUN for d in node_modules/.pnpm/@prisma+client@*/node_modules; do rm -rf "$d/.prisma" && cp -r /tmp/.prisma "$d/.prisma"; done \
 && rm -rf /tmp/.prisma

# ── API: compiled Nest app, migrations and the Prisma CLI (needed for `migrate deploy`)
FROM base AS api
ENV NODE_ENV=production
COPY --from=api-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages/types/dist ./packages/types/dist
COPY --from=build --chown=node:node /app/packages/validators/dist ./packages/validators/dist
COPY --from=build --chown=node:node /app/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /app/packages/costing-engine/dist ./packages/costing-engine/dist
# /app is already owned by node (COPY --chown); a chown -R of it here would duplicate the whole layer
RUN mkdir -p /data/uploads && chown -R node:node /data && chown node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]

# ── Web: Next.js standalone server
FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# service worker, app manifest icons
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
