FROM python:3.11-slim

# Install FFmpeg (needed for boundary frame extraction and MP4 encoding)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
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
