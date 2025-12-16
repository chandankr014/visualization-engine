#!/usr/bin/env bash
set -euo pipefail

# Creates a safe web root directory by SYMLINKING existing folders/files.
# Does not delete or move any repo files.
#
# Usage:
#   sudo bash deploy/scripts/setup_public.sh /opt/appdeploy
#

APP_DIR="${1:-/opt/appdeploy}"
PUBLIC_DIR="$APP_DIR/public"

mkdir -p "$PUBLIC_DIR"

link_item() {
  local name="$1"
  if [ -e "$PUBLIC_DIR/$name" ]; then
    echo "[setup_public] Exists: $PUBLIC_DIR/$name"
    return 0
  fi
  if [ ! -e "$APP_DIR/$name" ]; then
    echo "[setup_public] Missing source: $APP_DIR/$name" >&2
    return 1
  fi
  ln -s "$APP_DIR/$name" "$PUBLIC_DIR/$name"
  echo "[setup_public] Linked: $PUBLIC_DIR/$name -> $APP_DIR/$name"
}

# Web entry
link_item "viewer.html"

# Static assets
link_item "css"
link_item "js"

# Data served as static files
link_item "pmtiles"
link_item "city"

echo "[setup_public] Done. Web root: $PUBLIC_DIR"
