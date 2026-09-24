#!/usr/bin/env bash
# datvps - bộ cài 1 lệnh cho VPS Ubuntu trắng:
#   curl -fsSL https://raw.githubusercontent.com/datjbl932-web/buivandat/main/install.sh | sudo bash
# Tải datvps về /opt/datvps rồi chạy `dat setup` (Docker, UFW, proxy, lệnh dat, cron backup).
# Copyright (c) 2026 datvps. MIT License.
set -Eeuo pipefail

DATVPS_REPO="${DATVPS_REPO:-https://github.com/datjbl932-web/buivandat.git}"
DATVPS_BRANCH="${DATVPS_BRANCH:-main}"
DATVPS_DIR="${DATVPS_DIR:-/opt/datvps}"

[[ $EUID -eq 0 ]] || { echo "Cần quyền root: curl ... | sudo bash" >&2; exit 1; }

if ! command -v git >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates >/dev/null
fi

if [[ -d "$DATVPS_DIR/.git" ]]; then
  echo "==> Cập nhật datvps tại $DATVPS_DIR"
  git -C "$DATVPS_DIR" fetch --quiet origin "$DATVPS_BRANCH"
  git -C "$DATVPS_DIR" checkout --quiet "$DATVPS_BRANCH"
  git -C "$DATVPS_DIR" pull --ff-only --quiet origin "$DATVPS_BRANCH"
else
  echo "==> Tải datvps về $DATVPS_DIR"
  git clone --quiet --depth 1 --branch "$DATVPS_BRANCH" "$DATVPS_REPO" "$DATVPS_DIR"
fi
chmod +x "$DATVPS_DIR/bin/dat"

exec "$DATVPS_DIR/bin/dat" setup "$@"
