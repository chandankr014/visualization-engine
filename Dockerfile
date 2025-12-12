# ------------------------------
# Minimal Dockerfile for PMTiles Server
# ------------------------------

FROM python:3.11-slim

# Install only what is necessary
# RUN apt-get update && apt-get install -y --no-install-recommends \
    # && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy the full application
COPY . .

# Expose default port
EXPOSE 8000

# Run the server
CMD ["python", "server.py", "8000"]
