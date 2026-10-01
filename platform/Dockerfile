# syntax=docker/dockerfile:1.7
# Multi-stage build for the Next.js standalone server.
# Debian (glibc) rather than Alpine: Prisma engines and the argon2 native
# binding ship glibc builds, so no musl surprises in production.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── dependencies (cached on lockfile) ─────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── build ─────────────────────────────────────────────────────────────────
# Also the image used by the one-shot `migrate` service in docker-compose.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ── runtime ───────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
# Writable mount point for the local attachment driver (evaluation only).
RUN mkdir -p /app/.data/storage && chown -R app:app /app/.data
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
