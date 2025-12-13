# ------------------------------
# Minimal Dockerfile for PMTiles Server
# ------------------------------

FROM python:3.11-slim

# Install only what is necessary
# RUN apt-get update && apt-get install -y --no-install-recommends \
    # && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy only requirements first (for better caching)
COPY requirements.txt .

# Install Python deps (if you have none, comment this line)
RUN pip install --no-cache-dir -r requirements.txt || true

# Copy the full application
COPY . .

# Expose default port
EXPOSE 8000

# Run the server
CMD ["python", "server.py", "8000"]
