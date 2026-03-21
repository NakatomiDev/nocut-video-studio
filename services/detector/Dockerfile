FROM python:3.11-slim

# Install FFmpeg and audio libraries needed by librosa/soundfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY src/ ./src/

# Run as non-root
RUN useradd -r -s /bin/false appuser && \
    mkdir -p /tmp/numba_cache && chown appuser /tmp/numba_cache
USER appuser

# Prevent numba JIT cache errors in read-only container filesystems
ENV NUMBA_CACHE_DIR=/tmp/numba_cache

CMD ["python", "-m", "src.main"]
