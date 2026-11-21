# Build context: the repository root.   docker build -f infra/docker/api.Dockerfile --target runtime .
# Targets: "runtime" (the API server) and "tools" (migrations, seed, admin creation: has dev dependencies).
FROM node:26-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- all dependencies + compiled output
FROM base AS build
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN npm ci --workspace=@ethiotalent/api --include-workspace-root
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate && npx tsc -p tsconfig.build.json

# ---- one-off jobs: prisma migrate deploy, seed, admin:create (needs prisma and tsx)
FROM build AS tools
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed/index.ts"]

# ---- the server: production dependencies only, non-root user
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN npm ci --workspace=@ethiotalent/api --include-workspace-root --omit=dev

FROM base AS runtime
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
