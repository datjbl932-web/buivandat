# shellcheck shell=bash
# datvps - quản lý site: add, ls, info, domain, start/stop/restart, logs, wp, rm.

cmd_add() {
  local domain="" ssl="" email="" www=0 title="" admin_user="" admin_email="" cert="" key="" php=""
  while (($#)); do
    case $1 in
      --ssl) ssl=${2:-}; shift ;;
      --email) email=${2:-}; shift ;;
      --www) www=1 ;;
      --title) title=${2:-}; shift ;;
      --admin-user) admin_user=${2:-}; shift ;;
      --admin-email) admin_email=${2:-}; shift ;;
      --cert) cert=${2:-}; shift ;;
      --key) key=${2:-}; shift ;;
      --php) php=${2:-}; shift ;;
      -h|--help) usage_add; return 0 ;;
      -*) die "Tuỳ chọn không hợp lệ: $1" ;;
      *) [[ -z "$domain" ]] || die "Thừa tham số: $1"; domain=$1 ;;
    esac
    shift
  done
  require_root
  need_docker

  [[ -n "$domain" ]] || domain=$(ask "Domain (vd: example.com)")
  domain=${domain,,}; domain=${domain#https://}; domain=${domain#http://}; domain=${domain%%/*}; domain=${domain#www.}
  valid_domain "$domain" || die "Domain không hợp lệ: '$domain'"
  domain_in_use "$domain" && die "Domain $domain đã được dùng bởi site khác."
  docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1 || die "Chưa có proxy. Chạy: sudo dat setup"

  email=${email:-$DATVPS_EMAIL}
  if [[ -z "$ssl" ]]; then
    ssl=$(ask "Chế độ HTTPS: auto (Let's Encrypt) / origin (Cloudflare Origin Cert) / none" "auto")
  fi
  case $ssl in
    auto)
      [[ -n "$email" ]] || email=$(ask "Email cho Let's Encrypt")
      valid_email "$email" || die "Chế độ auto cần email hợp lệ (--email)." ;;
    origin|none) ;;
    *) die "--ssl phải là auto | origin | none" ;;
  esac
  case $php in
    ""|8.1|8.2|8.3|8.4) ;;
    *) die "--php hỗ trợ: 8.1 | 8.2 | 8.3 | 8.4" ;;
  esac

  title=${title:-$domain}
  admin_user=${admin_user:-"admin_$(rand_str 5 | tr '[:upper:]' '[:lower:]')"}
  admin_email=${admin_email:-${email:-admin@$domain}}
  valid_email "$admin_email" || die "Email admin không hợp lệ: $admin_email"

  local id dir
  id=$(make_id "$domain")
  dir="$SITES_DIR/$id"

  # Chuẩn bị cert trước khi tạo gì trên đĩa
  if [[ "$ssl" == origin ]]; then
    if [[ -z "$cert" || -z "$key" ]]; then
      new_tmpfile; cert=$TMPF; read_pem "Origin Certificate" "$cert"
      new_tmpfile; key=$TMPF; read_pem "Private Key" "$key"
    fi
    install_origin_cert "$domain" "$cert" "$key"
  fi

  info "Tạo site ${C_BOLD}$domain${C_RESET} (ID: $id)..."
  install -d -m 700 "$dir"
  install -d -m 755 "$dir/wordpress"
  install -d -m 700 "$dir/db"
  chown "$WWW_UID:$WWW_GID" "$dir/wordpress"
  install -m 644 "$DATVPS_HOME/templates/wordpress/compose.yml" "$dir/compose.yml"
  install -m 644 "$DATVPS_HOME/templates/wordpress/nginx.conf" "$dir/nginx.conf"
  install -m 644 "$DATVPS_HOME/templates/wordpress/php.ini" "$dir/php.ini"
  local compose_file=compose.yml
  if [[ "$ssl" == auto ]]; then
    install -m 644 "$DATVPS_HOME/templates/wordpress/compose.le.yml" "$dir/compose.le.yml"
    compose_file=compose.yml:compose.le.yml
  fi

  (umask 077; cat >"$dir/site.conf" <<EOF
ID=$id
DOMAIN=$domain
WWW=$www
SSL=$ssl
TYPE=wordpress
CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  cat >"$dir/.env" <<EOF
# datvps - biến môi trường của site $domain (KHÔNG chia sẻ file này)
COMPOSE_PROJECT_NAME=site-$id
COMPOSE_FILE=$compose_file
SITE_ID=$id
VIRTUAL_HOST=$(hosts_for "$domain" "$www")
LETSENCRYPT_EMAIL=$email
PROXY_NETWORK=$PROXY_NETWORK
DB_NAME=wp
DB_USER=wp
DB_PREFIX=wp_
DB_PASSWORD=$(rand_str 32)
DB_ROOT_PASSWORD=$(rand_str 32)
REDIS_PASSWORD=$(rand_str 32)
PHP_IMAGE=wordpress:php${php:-8.3}-fpm
CLI_IMAGE=wordpress:cli-php${php:-8.3}
MEM_DB=512m
MEM_PHP=512m
MEM_WEB=128m
MEM_REDIS=192m
EOF
  )

  site_load "$id"
  # Nếu cài đặt lỗi giữa chừng: dọn sạch để không để lại site "nửa vời"
  ADD_ROLLBACK_CERT=""
  [[ "$ssl" == origin ]] && ADD_ROLLBACK_CERT=$domain
  ADD_IN_PROGRESS=1

  info "Khởi động container (lần đầu sẽ tải image, có thể mất vài phút)..."
  site_compose pull -q
  site_compose --profile tools pull -q cli
  site_compose up -d
  wait_db_healthy

  for _ in $(seq 1 60); do
    [[ -f "$dir/wordpress/wp-config.php" && -f "$dir/wordpress/wp-includes/version.php" ]] && break
    sleep 2
  done
  [[ -f "$dir/wordpress/wp-config.php" ]] || die "WordPress container chưa tạo wp-config.php. Xem: dat logs $id php"

  info "Cài đặt WordPress..."
  local admin_pass
  admin_pass=$(rand_str 20)
  site_wp core install --url="$(site_url)" --title="$title" --admin_user="$admin_user" \
    --admin_password="$admin_pass" --admin_email="$admin_email" --skip-email >/dev/null
  ADD_IN_PROGRESS=0

  site_wp option update timezone_string "$DATVPS_TZ" >/dev/null || warn "Không đặt được timezone."
  site_wp rewrite structure '/%postname%/' >/dev/null || true
  site_wp plugin delete hello akismet >/dev/null 2>&1 || true
  if site_wp plugin install redis-cache --activate >/dev/null 2>&1 && site_wp redis enable >/dev/null 2>&1; then
    ok "Redis object cache đã bật"
  else
    warn "Chưa bật được Redis cache (có thể bật sau: dat wp $id plugin install redis-cache --activate)"
  fi
  fix_perms

  (umask 077; cat >"$dir/credentials.txt" <<EOF
URL:        $(site_url)/wp-admin/
Username:   $admin_user
Password:   $admin_pass
Email:      $admin_email
EOF
  )

  echo
  ok "${C_BOLD}Site $domain đã sẵn sàng!${C_RESET}"
  cat <<EOF
   ID:        $id
   URL:       $(site_url)
   Admin:     $(site_url)/wp-admin/
   Username:  $admin_user
   Password:  $admin_pass
   (Đã lưu tại $dir/credentials.txt, chỉ root đọc được)
EOF
  case $ssl in
    auto)   echo "   HTTPS:     Let's Encrypt tự cấp sau khi domain trỏ đúng IP VPS (1-2 phút)." ;;
    origin) echo "   HTTPS:     Cloudflare Origin Cert. Bật proxy (đám mây cam) + SSL/TLS = Full (strict)." ;;
    none)   echo "   HTTPS:     tắt (chỉ HTTP)." ;;
  esac
}

# Gọi từ on_exit khi `dat add` thất bại giữa chừng
add_rollback() {
  warn "Tạo site thất bại, đang dọn dẹp $SITE_ID..."
  site_compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$SITE_DIR"
  if [[ -n "${ADD_ROLLBACK_CERT:-}" ]]; then
    rm -f "$PROXY_DIR/certs/$ADD_ROLLBACK_CERT.crt" "$PROXY_DIR/certs/$ADD_ROLLBACK_CERT.key"
  fi
}

cmd_ls() {
  local id ids running total
  ids=$(site_ids)
  if [[ -z "$ids" ]]; then echo "Chưa có site nào. Tạo site: dat add example.com"; return 0; fi
  need_docker
  printf '%s%-28s %-32s %-7s %-9s%s\n' "$C_BOLD" "ID" "DOMAIN" "SSL" "TRẠNG THÁI" "$C_RESET"
  for id in $ids; do
    site_load "$id"
    total=4
    running=$(site_running_count)
    local state="${C_RED}dừng${C_RESET}"
    if (( running >= total )); then state="${C_GREEN}chạy${C_RESET}"
    elif (( running > 0 )); then state="${C_YELLOW}${running}/${total}${C_RESET}"; fi
    printf '%-28s %-32s %-7s %s\n' "$id" "$SITE_DOMAIN" "$SITE_SSL" "$state"
  done
}

cmd_info() {
  local id
  id=$(site_resolve "${1:-}")
  site_load "$id"
  need_docker
  cat <<EOF
${C_BOLD}$SITE_DOMAIN${C_RESET}
  ID:           $SITE_ID
  URL:          $(site_url)
  Hosts:        $(conf_get "$SITE_DIR/.env" VIRTUAL_HOST)
  HTTPS:        $SITE_SSL
  Tạo lúc:      $SITE_CREATED
  Thư mục:      $SITE_DIR
  PHP image:    $(conf_get "$SITE_DIR/.env" PHP_IMAGE)
  Database:     $(conf_get "$SITE_DIR/.env" DB_NAME) (user $(conf_get "$SITE_DIR/.env" DB_USER))
  Dung lượng:   $(du -sh "$SITE_DIR" 2>/dev/null | cut -f1)
  Tài khoản:    $SITE_DIR/credentials.txt
EOF
  echo
  site_compose ps
}

cmd_domain() {
  local site="" new="" cert="" key="" www=""
  while (($#)); do
    case $1 in
      --cert) cert=${2:-}; shift ;;
      --key) key=${2:-}; shift ;;
      --www) www=1 ;;
      --no-www) www=0 ;;
      -*) die "Tuỳ chọn không hợp lệ: $1" ;;
      *) if [[ -z "$site" ]]; then site=$1; elif [[ -z "$new" ]]; then new=$1; else die "Thừa tham số: $1"; fi ;;
    esac
    shift
  done
  require_root
  need_docker
  [[ -n "$site" && -n "$new" ]] || die "Cách dùng: dat domain <site> <domain-mới> [--www|--no-www] [--cert f --key f]"
  site_load "$(site_resolve "$site")"
  new=${new,,}; new=${new#https://}; new=${new#http://}; new=${new%%/*}; new=${new#www.}
  valid_domain "$new" || die "Domain không hợp lệ: $new"
  www=${www:-$SITE_WWW}
  local old=$SITE_DOMAIN old_www=$SITE_WWW
  [[ "$new" != "$old" || "$www" != "$old_www" ]] || die "Domain mới trùng domain hiện tại."
  domain_in_use "$new" "$SITE_ID" && die "Domain $new đã được site khác dùng."

  if [[ "$SITE_SSL" == origin && "$new" != "$old" ]]; then
    if [[ -z "$cert" || -z "$key" ]]; then
      new_tmpfile; cert=$TMPF; read_pem "Origin Certificate cho $new" "$cert"
      new_tmpfile; key=$TMPF; read_pem "Private Key cho $new" "$key"
    fi
    install_origin_cert "$new" "$cert" "$key"
  fi

  confirm "Đổi domain $old → $new cho site $SITE_ID?" || die "Đã huỷ."
  info "Sao lưu trước khi đổi domain..."
  backup_site "$SITE_ID"

  conf_set "$SITE_DIR/site.conf" DOMAIN "$new"
  conf_set "$SITE_DIR/site.conf" WWW "$www"
  conf_set "$SITE_DIR/.env" VIRTUAL_HOST "$(hosts_for "$new" "$www")"
  SITE_DOMAIN=$new SITE_WWW=$www

  info "Cập nhật container..."
  site_compose up -d
  wait_db_healthy

  if [[ "$new" != "$old" ]]; then
    info "Thay domain trong database (search-replace)..."
    local pair from to
    for pair in "//www.$old|//www.$new" "//$old|//$new" "\\/\\/www.$old|\\/\\/www.$new" "\\/\\/$old|\\/\\/$new"; do
      from=${pair%%|*} to=${pair#*|}
      site_wp search-replace "$from" "$to" --all-tables-with-prefix --skip-columns=guid --precise --quiet
    done
  fi
  site_wp option update home "$(site_url)" >/dev/null
  site_wp option update siteurl "$(site_url)" >/dev/null
  site_wp cache flush >/dev/null 2>&1 || true
  if [[ "$SITE_SSL" == origin && "$new" != "$old" ]]; then
    rm -f "$PROXY_DIR/certs/$old.crt" "$PROXY_DIR/certs/$old.key"
  fi
  ok "Đã đổi domain: $(site_url)"
}

cmd_lifecycle() {
  local action=$1 target=${2:-}
  require_root
  need_docker
  [[ -n "$target" ]] || die "Cách dùng: dat $action <site|all>"
  local ids id
  if [[ "$target" == all ]]; then ids=$(site_ids); else ids=$(site_resolve "$target"); fi
  for id in $ids; do
    site_load "$id"
    case $action in
      start)   site_compose up -d ;;
      stop)    site_compose stop ;;
      restart) site_compose restart ;;
    esac
    ok "$action: $SITE_DOMAIN"
  done
}

cmd_logs() {
  local site=${1:-} svc=${2:-}
  need_docker
  site_load "$(site_resolve "$site")"
  case $svc in
    ""|web|php|db|redis) ;;
    *) die "Dịch vụ phải là: web | php | db | redis" ;;
  esac
  # shellcheck disable=SC2086
  site_compose logs -f --tail=200 $svc
}

cmd_wp() {
  local site=${1:-}
  [[ -n "$site" ]] || die "Cách dùng: dat wp <site> <lệnh wp-cli...>"
  shift
  require_root
  need_docker
  site_load "$(site_resolve "$site")"
  site_wp "$@"
}

cmd_fix_perms() {
  require_root
  site_load "$(site_resolve "${1:-}")"
  fix_perms
  ok "Đã chuẩn hoá quyền file: $SITE_DOMAIN"
}

cmd_rm() {
  local site="" nobackup=0
  while (($#)); do
    case $1 in
      --no-backup) nobackup=1 ;;
      -y|--yes) DATVPS_YES=1 ;;
      -*) die "Tuỳ chọn không hợp lệ: $1" ;;
      *) site=$1 ;;
    esac
    shift
  done
  require_root
  need_docker
  site_load "$(site_resolve "$site")"

  if [[ "$DATVPS_YES" != 1 ]]; then
    interactive || die "Thêm --yes để xoá không hỏi."
    local typed
    typed=$(ask "Nhập lại domain '$SITE_DOMAIN' để xác nhận XOÁ site")
    [[ "$typed" == "$SITE_DOMAIN" ]] || die "Không khớp, đã huỷ."
  fi

  if (( ! nobackup )); then
    info "Tạo bản backup cuối cùng..."
    backup_site "$SITE_ID"
  fi
  site_compose --profile tools down -v --remove-orphans
  rm -rf "$SITE_DIR"
  if [[ "$SITE_SSL" == origin ]]; then
    rm -f "$PROXY_DIR/certs/$SITE_DOMAIN.crt" "$PROXY_DIR/certs/$SITE_DOMAIN.key"
  fi
  ok "Đã xoá site $SITE_DOMAIN ($SITE_ID)"
}
