# Ryloom FFmpeg processing worker.
# Build context = the MONOREPO ROOT, e.g.:
#   docker build -f apps/worker/Dockerfile -t ryloom-worker .
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Workspace manifests + the two packages the worker needs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

# Install only the worker's dependency subtree.
RUN pnpm install --filter @ryloom/worker... --no-frozen-lockfile

ENV NODE_ENV=production

# pnpm places tsx in the worker package's own .bin
CMD ["pnpm", "--filter", "@ryloom/worker", "start"]
