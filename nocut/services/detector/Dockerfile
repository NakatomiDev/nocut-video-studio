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
RUN useradd -r -s /bin/false appuser
USER appuser

CMD ["python", "-m", "src.main"]
