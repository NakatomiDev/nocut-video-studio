FROM node:20-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Run as non-root
RUN useradd -r -s /bin/false appuser
USER appuser

CMD ["node", "dist/index.js"]
