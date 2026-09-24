# shellcheck shell=bash
# datvps - update (lệnh dat), upgrade (image + OS), status.

cmd_update() {
  require_root
  [[ -d "$DATVPS_HOME/.git" ]] || die "$DATVPS_HOME không phải git repo, không tự cập nhật được."
  local before after
  before=$(cat "$DATVPS_HOME/VERSION")
  info "Cập nhật datvps từ git..."
  git -C "$DATVPS_HOME" pull --ff-only --quiet
  after=$(cat "$DATVPS_HOME/VERSION")
  ln -sfn "$DATVPS_HOME/bin/dat" /usr/local/bin/dat
  # Cấu hình proxy có thể thay đổi giữa các phiên bản
  if [[ -f "$PROXY_DIR/.env" ]]; then
    install -m 644 "$DATVPS_HOME/proxy/datvps.conf" "$PROXY_DIR/conf.d/datvps.conf"
    proxy_compose up -d --remove-orphans >/dev/null
  fi
  if [[ "$before" == "$after" ]]; then ok "Đang ở bản mới nhất ($after)"; else ok "Đã cập nhật $before → $after"; fi
  echo "   Lưu ý: template mới chỉ áp dụng cho site tạo sau. Site cũ giữ nguyên cấu hình."
}

cmd_upgrade() {
  local os=1
  [[ "${1:-}" == --no-os ]] && os=0
  require_root
  need_docker
  if (( os )); then
    info "Cập nhật gói hệ điều hành..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade >/dev/null
  fi
  info "Cập nhật image proxy..."
  proxy_compose pull -q
  proxy_compose up -d --remove-orphans
  local id
  for id in $(site_ids); do
    site_load "$id"
    info "Cập nhật image site $SITE_DOMAIN..."
    site_compose --profile tools pull -q
    # Chỉ khởi động lại site đang chạy
    if (( $(site_running_count) > 0 )); then site_compose up -d; fi
  done
  docker image prune -f >/dev/null
  ok "Nâng cấp xong."
  [[ -f /var/run/reboot-required ]] && warn "Hệ điều hành yêu cầu khởi động lại (reboot)."
  return 0
}

cmd_status() {
  need_docker
  echo "${C_BOLD}datvps $DATVPS_VERSION${C_RESET}  ($(hostname))"
  echo
  echo "${C_BOLD}Hệ thống${C_RESET}"
  printf '  Uptime:   %s\n' "$(uptime -p 2>/dev/null || true)"
  printf '  Load:     %s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"
  printf '  RAM:      %s\n' "$(free -h | awk '/^Mem:/ { print $3 " / " $2 }')"
  printf '  Swap:     %s\n' "$(free -h | awk '/^Swap:/ { print $3 " / " $2 }')"
  printf '  Ổ đĩa /:  %s\n' "$(df -h / | awk 'NR == 2 { print $3 " / " $2 " (" $5 ")" }')"
  echo
  echo "${C_BOLD}Proxy${C_RESET}"
  local c s
  for c in datvps-proxy datvps-acme; do
    s=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "không có")
    printf '  %-14s %s\n' "$c" "$s"
  done
  echo
  echo "${C_BOLD}Sites${C_RESET}"
  cmd_ls
  echo
  cmd_cron status
}
