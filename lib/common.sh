# shellcheck shell=bash
# datvps - hàm dùng chung: cấu hình, log, validate, tiện ích site.
# Copyright (c) 2026 datvps. MIT License.

DATVPS_VERSION="$(cat "$DATVPS_HOME/VERSION" 2>/dev/null || echo dev)"
DATVPS_CONF="${DATVPS_CONF:-/etc/datvps.conf}"
# shellcheck source=/dev/null
[[ -r "$DATVPS_CONF" ]] && . "$DATVPS_CONF"

SITES_DIR="${SITES_DIR:-/opt/sites}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
PROXY_DIR="${PROXY_DIR:-/opt/proxy}"
PROXY_NETWORK="${PROXY_NETWORK:-datvps_proxy}"
KEEP_BACKUPS="${KEEP_BACKUPS:-7}"
DATVPS_EMAIL="${DATVPS_EMAIL:-}"
DATVPS_TZ="${DATVPS_TZ:-Asia/Ho_Chi_Minh}"
DATVPS_YES="${DATVPS_YES:-0}"
DATVPS_QUIET="${DATVPS_QUIET:-0}"

# Đường dẫn tạm cần xoá khi thoát (xem on_exit trong bin/dat)
CLEANUP_PATHS=()
# new_tmpdir -> đặt biến TMPD (không dùng $(...) để mảng CLEANUP_PATHS không bị mất trong subshell)
new_tmpdir() { TMPD=$(mktemp -d); CLEANUP_PATHS+=("$TMPD"); }
new_tmpfile() { TMPF=$(mktemp); CLEANUP_PATHS+=("$TMPF"); }
cleanup_tmp() { ((${#CLEANUP_PATHS[@]})) && rm -rf -- "${CLEANUP_PATHS[@]}"; CLEANUP_PATHS=(); }

# UID/GID của www-data trong image wordpress (Debian).
WWW_UID=33
WWW_GID=33

if [[ -t 1 ]]; then
  C_RESET=$'\e[0m' C_BOLD=$'\e[1m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m'
else
  C_RESET='' C_BOLD='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi

info() { [[ "$DATVPS_QUIET" == 1 ]] || printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*" >&2; }
ok()   { [[ "$DATVPS_QUIET" == 1 ]] || printf '%s ✔ %s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }
warn() { printf '%s !  %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
die()  { printf '%s ✘  %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }

require_root() { [[ $EUID -eq 0 ]] || die "Cần chạy với quyền root (sudo dat ...)."; }

# Có thể hỏi người dùng không (kể cả khi chạy qua `curl | bash`).
interactive() {
  [[ "$DATVPS_YES" != 1 && -t 1 ]] && { : </dev/tty; } 2>/dev/null
}

# ask "Câu hỏi" [mặc định] -> in câu trả lời ra stdout
ask() {
  local prompt=$1 def=${2:-} ans
  if ! interactive; then printf '%s' "$def"; return 0; fi
  if [[ -n "$def" ]]; then prompt+=" [$def]"; fi
  read -r -p "$prompt: " ans </dev/tty >/dev/tty 2>&1 || true
  printf '%s' "${ans:-$def}"
}

ask_secret() {
  local ans
  interactive || return 0
  read -r -s -p "$1: " ans </dev/tty; echo >/dev/tty
  printf '%s' "$ans"
}

confirm() {
  [[ "$DATVPS_YES" == 1 ]] && return 0
  interactive || die "Thao tác cần xác nhận. Thêm --yes để chạy không hỏi."
  local ans
  read -r -p "$1 [y/N]: " ans </dev/tty
  [[ "$ans" =~ ^[YyCc] ]]
}

rand_str() {
  local n=${1:-32} out=""
  while (( ${#out} < n )); do
    out+=$(head -c 64 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')
  done
  printf '%s' "${out:0:n}"
}

lower() { printf '%s' "${1,,}"; }

valid_domain() {
  local d=${1,,}
  (( ${#d} <= 253 )) && [[ "$d" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]]
}

valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$ ]]; }

valid_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]]; }

# "example.com" 1 -> "example.com,www.example.com"
hosts_for() {
  if [[ "${2:-0}" == 1 ]]; then printf '%s,www.%s' "$1" "$1"; else printf '%s' "$1"; fi
}

# ID bất biến của site, sinh từ domain + hậu tố ngẫu nhiên: my-blog-com-3f2a
make_id() {
  local base id
  base=$(printf '%s' "${1,,}" | tr -c 'a-z0-9' '-' | tr -s '-')
  base=${base:0:24}; base=${base%-}; base=${base#-}
  while :; do
    id="${base}-$(printf '%04x' $((RANDOM % 65536)))"
    [[ -e "$SITES_DIR/$id" ]] || break
  done
  printf '%s' "$id"
}

# conf_get FILE KEY -> giá trị (file dạng KEY=VALUE, không quote)
conf_get() {
  [[ -r "$1" ]] || return 0
  awk -v k="$2" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { printf "%s", v }' "$1"
}

# conf_set FILE KEY VALUE (giữ nguyên quyền file)
conf_set() {
  local f=$1 k=$2 v=$3 tmp
  [[ -e "$f" ]] || { (umask 077; : >"$f"); }
  tmp=$(mktemp)
  awk -v k="$k" -v v="$v" '
    index($0, k "=") == 1 { if (!d) print k "=" v; d = 1; next }
    { print }
    END { if (!d) print k "=" v }' "$f" >"$tmp"
  cat "$tmp" >"$f"
  rm -f "$tmp"
}

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Chưa có Docker. Chạy: sudo dat setup"
  docker compose version >/dev/null 2>&1 || die "Thiếu docker compose v2. Chạy: sudo dat setup"
}

# ---------- site ----------

site_ids() {
  local f
  for f in "$SITES_DIR"/*/site.conf; do
    [[ -e "$f" ]] || continue
    basename "$(dirname "$f")"
  done
}

# site_resolve <id|domain> -> id
site_resolve() {
  local key=${1:-} id d
  [[ -n "$key" ]] || die "Thiếu tham số site (ID hoặc domain)."
  key=${key,,}; key=${key#https://}; key=${key#http://}; key=${key%%/*}
  if valid_id "$key" && [[ -f "$SITES_DIR/$key/site.conf" ]]; then printf '%s' "$key"; return 0; fi
  for id in $(site_ids); do
    d=$(conf_get "$SITES_DIR/$id/site.conf" DOMAIN)
    if [[ "$key" == "$d" || "$key" == "www.$d" ]]; then printf '%s' "$id"; return 0; fi
  done
  die "Không tìm thấy site: $1"
}

# Nạp thông tin site vào biến SITE_*
site_load() {
  SITE_ID=$1
  SITE_DIR="$SITES_DIR/$SITE_ID"
  [[ -f "$SITE_DIR/site.conf" ]] || die "Site $SITE_ID không tồn tại."
  SITE_DOMAIN=$(conf_get "$SITE_DIR/site.conf" DOMAIN)
  SITE_WWW=$(conf_get "$SITE_DIR/site.conf" WWW)
  SITE_SSL=$(conf_get "$SITE_DIR/site.conf" SSL)
  SITE_CREATED=$(conf_get "$SITE_DIR/site.conf" CREATED)
  SITE_WWW=${SITE_WWW:-0}
}

site_url() {
  if [[ "$SITE_SSL" == none ]]; then printf 'http://%s' "$SITE_DOMAIN"; else printf 'https://%s' "$SITE_DOMAIN"; fi
}

domain_in_use() {
  local d=${1,,} id sd
  for id in $(site_ids); do
    [[ "$id" == "${2:-}" ]] && continue
    sd=$(conf_get "$SITES_DIR/$id/site.conf" DOMAIN)
    if [[ "$d" == "$sd" || "$d" == "www.$sd" || "www.$d" == "$sd" ]]; then return 0; fi
  done
  return 1
}

# docker compose trong thư mục site (.env tự nạp, COMPOSE_FILE/PROJECT_NAME lấy từ .env).
# Phải cd vào thư mục site vì COMPOSE_FILE tương đối được tính theo thư mục hiện tại.
site_compose() {
  (cd "$SITE_DIR" && docker compose "$@")
}

# Chạy wp-cli cho site đang nạp
site_wp() {
  local tty=()
  [[ -t 0 && -t 1 ]] || tty=(-T)
  site_compose --progress quiet --profile tools run --rm "${tty[@]}" cli wp "$@"
}

site_running_count() {
  site_compose ps --status running -q 2>/dev/null | grep -c . || true
}

wait_db_healthy() {
  local cid status
  for _ in $(seq 1 90); do
    cid=$(site_compose ps -q db 2>/dev/null || true)
    if [[ -n "$cid" ]]; then
      status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)
      [[ "$status" == healthy ]] && return 0
    fi
    sleep 2
  done
  die "Database của $SITE_ID không sẵn sàng sau 3 phút. Xem: dat logs $SITE_ID db"
}

db_exec_root() {
  # shellcheck disable=SC2016
  site_compose exec -T db sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$@"' sh "$@"
}

fix_perms() {
  local w="$SITE_DIR/wordpress"
  [[ -d "$w" ]] || return 0
  chown -R "$WWW_UID:$WWW_GID" "$w"
  find "$w" -type d -exec chmod 755 {} +
  find "$w" -type f -exec chmod 644 {} +
  [[ -f "$w/wp-config.php" ]] && chmod 640 "$w/wp-config.php"
  return 0
}

install_origin_cert() {
  # install_origin_cert DOMAIN CERT_FILE KEY_FILE
  local d=$1 crt=$2 key=$3
  [[ -s "$crt" ]] || die "Không đọc được file cert: $crt"
  [[ -s "$key" ]] || die "Không đọc được file key: $key"
  grep -q 'BEGIN CERTIFICATE' "$crt" || die "File cert không đúng định dạng PEM."
  grep -q 'PRIVATE KEY' "$key" || die "File key không đúng định dạng PEM."
  if command -v openssl >/dev/null 2>&1; then
    openssl x509 -in "$crt" -noout 2>/dev/null || die "Cert không hợp lệ."
    local a b
    a=$(openssl x509 -in "$crt" -noout -pubkey 2>/dev/null | openssl sha256)
    b=$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl sha256)
    [[ "$a" == "$b" ]] || die "Cert và private key không khớp nhau."
  fi
  install -d -m 755 "$PROXY_DIR/certs"
  install -m 644 "$crt" "$PROXY_DIR/certs/$d.crt"
  install -m 600 "$key" "$PROXY_DIR/certs/$d.key"
}

# Dán PEM từ bàn phím, kết thúc khi gặp dòng -----END ...-----
read_pem() {
  local label=$1 out=$2 line
  interactive || die "Thiếu --cert/--key cho chế độ origin."
  printf '%s\n' "Dán $label (kết thúc bằng dòng -----END ...-----):" >/dev/tty
  : >"$out"
  while IFS= read -r line </dev/tty; do
    printf '%s\n' "$line" >>"$out"
    [[ "$line" == -----END* ]] && break
  done
}
