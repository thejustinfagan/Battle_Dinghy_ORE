# Battle Dinghy - Production Dockerfile

FROM node:20-slim AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Install canvas dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/core ./packages/core
COPY packages/server ./packages/server

# Build
RUN pnpm -r build

# Production stage
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built files
COPY --from=base /app/packages/core/dist ./packages/core/dist
COPY --from=base /app/packages/core/package.json ./packages/core/
COPY --from=base /app/packages/server/dist ./packages/server/dist
COPY --from=base /app/packages/server/package.json ./packages/server/
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=base /app/packages/server/node_modules ./packages/server/node_modules

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
