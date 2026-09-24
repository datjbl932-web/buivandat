# shellcheck shell=bash
# datvps - cài đặt hệ thống: Docker, UFW, swap, front proxy, lệnh `dat`, cron backup.

cmd_setup() {
  local email="" ufw=1 swap=1 cron=1
  while (($#)); do
    case $1 in
      --email) email=${2:-}; shift ;;
      --no-ufw) ufw=0 ;;
      --no-swap) swap=0 ;;
      --no-cron) cron=0 ;;
      -h|--help) usage_setup; return 0 ;;
      *) die "Tuỳ chọn không hợp lệ: $1" ;;
    esac
    shift
  done
  require_root

  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    [[ "${ID:-}" == ubuntu || "${ID_LIKE:-}" == *debian* || "${ID:-}" == debian ]] \
      || warn "datvps được kiểm thử trên Ubuntu 22.04/24.04; hệ điều hành hiện tại: ${PRETTY_NAME:-?}"
  fi

  setup_packages
  setup_docker
  (( swap )) && setup_swap
  (( ufw )) && setup_ufw
  setup_config "$email"
  setup_proxy
  ln -sfn "$DATVPS_HOME/bin/dat" /usr/local/bin/dat
  ok "Đã cài lệnh: dat"
  (( cron )) && cmd_cron on

  echo
  ok "${C_BOLD}datvps $DATVPS_VERSION đã sẵn sàng.${C_RESET}"
  echo "   Tạo site đầu tiên:  dat add example.com"
  echo "   Mở menu:            dat"

  if interactive && [[ -z "$(site_ids)" ]]; then
    local d
    d=$(ask "Nhập domain để tạo site đầu tiên (bỏ trống để bỏ qua)")
    [[ -n "$d" ]] && cmd_add "$d"
  fi
  return 0
}

setup_packages() {
  info "Cài gói hệ thống..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git openssl tar gzip cron ufw whiptail >/dev/null
}

setup_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    info "Cài Docker (get.docker.com)..."
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  docker compose version >/dev/null 2>&1 || {
    apt-get install -y -qq docker-compose-plugin >/dev/null || die "Không cài được docker compose plugin."
  }
  if [[ ! -f /etc/docker/daemon.json ]]; then
    mkdir -p /etc/docker
    cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
}

setup_swap() {
  local mem_mb
  mem_mb=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
  if (( mem_mb < 2048 )) && [[ -z "$(swapon --show --noheadings 2>/dev/null)" ]] && [[ ! -e /swapfile ]]; then
    info "RAM ${mem_mb}MB, tạo swap 2GB..."
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    sysctl -q vm.swappiness=10
    echo 'vm.swappiness=10' >/etc/sysctl.d/99-datvps.conf
    ok "Đã bật swap 2GB"
  fi
}

setup_ufw() {
  local ssh_port
  ssh_port=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')
  ssh_port=${ssh_port:-22}
  info "Cấu hình UFW: chỉ mở ${ssh_port}(SSH), 80, 443..."
  ufw allow "${ssh_port}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "UFW đã bật"
}

setup_config() {
  local email=$1
  email=${email:-$DATVPS_EMAIL}
  if [[ -z "$email" ]]; then
    email=$(ask "Email nhận thông báo Let's Encrypt (bỏ trống nếu chỉ dùng Cloudflare Origin)")
  fi
  if [[ -n "$email" ]] && ! valid_email "$email"; then die "Email không hợp lệ: $email"; fi
  DATVPS_EMAIL=$email

  if [[ ! -f "$DATVPS_CONF" ]]; then
    (umask 077; cat >"$DATVPS_CONF" <<EOF
# datvps - cấu hình chung
DATVPS_EMAIL=$email
SITES_DIR=$SITES_DIR
BACKUP_DIR=$BACKUP_DIR
PROXY_DIR=$PROXY_DIR
PROXY_NETWORK=$PROXY_NETWORK
KEEP_BACKUPS=$KEEP_BACKUPS
DATVPS_TZ=$DATVPS_TZ
EOF
    )
  else
    conf_set "$DATVPS_CONF" DATVPS_EMAIL "$email"
  fi
  install -d -m 700 "$SITES_DIR" "$BACKUP_DIR"
}

proxy_compose() {
  docker compose -p datvps-proxy -f "$DATVPS_HOME/proxy/compose.yml" --env-file "$PROXY_DIR/.env" "$@"
}

setup_proxy() {
  info "Khởi động front proxy (nginx-proxy + acme-companion)..."
  install -d -m 755 "$PROXY_DIR" "$PROXY_DIR/certs" "$PROXY_DIR/vhost.d" "$PROXY_DIR/html" "$PROXY_DIR/conf.d"
  install -d -m 700 "$PROXY_DIR/acme"
  install -m 644 "$DATVPS_HOME/proxy/datvps.conf" "$PROXY_DIR/conf.d/datvps.conf"
  cat >"$PROXY_DIR/.env" <<EOF
PROXY_DIR=$PROXY_DIR
PROXY_NETWORK=$PROXY_NETWORK
ACME_EMAIL=$DATVPS_EMAIL
EOF
  docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1 || docker network create "$PROXY_NETWORK" >/dev/null
  proxy_compose up -d --remove-orphans
  ok "Proxy đang chạy (80/443)"
}
