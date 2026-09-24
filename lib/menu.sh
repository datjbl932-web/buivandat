# shellcheck shell=bash
# datvps - menu TUI (whiptail). Mỗi thao tác chạy `dat <lệnh>` trong tiến trình riêng
# để lỗi của 1 thao tác không đóng menu.

WT_TITLE="datvps"

wt() { whiptail --title "$WT_TITLE" "$@" 3>&1 1>&2 2>&3; }

run_dat() {
  clear
  echo "\$ dat $*"
  echo
  "$DATVPS_HOME/bin/dat" "$@" || true
  echo
  read -r -p "Nhấn Enter để quay lại menu..." _ </dev/tty
}

# Chọn 1 site -> in ID
pick_site() {
  local items=() id d
  for id in $(site_ids); do
    d=$(conf_get "$SITES_DIR/$id/site.conf" DOMAIN)
    items+=("$id" "$d")
  done
  if ((${#items[@]} == 0)); then
    wt --msgbox "Chưa có site nào." 8 40 || true
    return 1
  fi
  wt --menu "${1:-Chọn site}" 20 70 12 "${items[@]}"
}

menu_add() {
  local domain ssl email=""
  domain=$(wt --inputbox "Domain (vd: example.com):" 9 60) || return 0
  [[ -n "$domain" ]] || return 0
  ssl=$(wt --menu "Chế độ HTTPS" 14 72 3 \
    auto   "Let's Encrypt tự động (domain trỏ thẳng về VPS)" \
    origin "Cloudflare Origin Certificate (proxy cam)" \
    none   "Không HTTPS (chỉ để thử nghiệm)") || return 0
  if [[ "$ssl" == auto && -z "$DATVPS_EMAIL" ]]; then
    email=$(wt --inputbox "Email cho Let's Encrypt:" 9 60) || return 0
  fi
  local args=(add "$domain" --ssl "$ssl")
  [[ -n "$email" ]] && args+=(--email "$email")
  if wt --yesno "Thêm cả www.$domain?" 8 50; then args+=(--www); fi
  run_dat "${args[@]}"
}

menu_domain() {
  local id new
  id=$(pick_site "Đổi domain cho site") || return 0
  new=$(wt --inputbox "Domain mới:" 9 60) || return 0
  if [[ -n "$new" ]]; then run_dat domain "$id" "$new"; fi
}

menu_restore() {
  local id files=() f
  id=$(pick_site "Khôi phục site") || return 0
  while IFS= read -r f; do
    files+=("$f" "$(du -h "$f" | cut -f1)")
  done < <(find "$BACKUP_DIR/$id" -maxdepth 1 -type f -name '*.tar.gz' 2>/dev/null | sort -r)
  if ((${#files[@]} == 0)); then wt --msgbox "Site này chưa có backup." 8 40 || true; return 0; fi
  f=$(wt --menu "Chọn bản backup" 20 90 12 "${files[@]}") || return 0
  run_dat restore "$f" "$id"
}

menu_site_action() {
  local action=$1 id
  id=$(pick_site "Chọn site để: $action") || return 0
  run_dat "$action" "$id"
}

cmd_menu() {
  command -v whiptail >/dev/null 2>&1 || die "Thiếu whiptail (apt install whiptail). Xem: dat help"
  local choice
  while :; do
    choice=$(wt --menu "datvps $DATVPS_VERSION - quản lý WordPress đa site" 24 70 16 \
      1 "Danh sách site" \
      2 "Tạo site WordPress mới" \
      3 "Thông tin site" \
      4 "Đổi domain" \
      5 "Backup 1 site" \
      6 "Backup tất cả site" \
      7 "Khôi phục từ backup" \
      8 "Khởi động lại site" \
      9 "Dừng site" \
      10 "Bật site" \
      11 "Xem log site" \
      12 "Xoá site" \
      13 "Trạng thái hệ thống" \
      14 "Cập nhật datvps" \
      15 "Nâng cấp hệ thống (OS + image)" \
      0 "Thoát") || break
    case $choice in
      1) run_dat ls ;;
      2) menu_add ;;
      3) menu_site_action info ;;
      4) menu_domain ;;
      5) menu_site_action backup ;;
      6) run_dat backup all ;;
      7) menu_restore ;;
      8) menu_site_action restart ;;
      9) menu_site_action stop ;;
      10) menu_site_action start ;;
      11) menu_site_action logs ;;
      12) menu_site_action rm ;;
      13) run_dat status ;;
      14) run_dat update ;;
      15) run_dat upgrade ;;
      0) break ;;
    esac
  done
  clear
}
