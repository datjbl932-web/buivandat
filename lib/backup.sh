# shellcheck shell=bash
# datvps - backup, restore, cron backup hằng ngày.

# backup_site <id> -> tạo backup, đặt đường dẫn vào BACKUP_FILE
backup_site() {
  site_load "$1"
  local out_dir="$BACKUP_DIR/$SITE_ID" ts tmp out started_db=0
  ts=$(date +%Y%m%d-%H%M%S)
  out="$out_dir/$SITE_ID-$ts.tar.gz"
  install -d -m 700 "$BACKUP_DIR" "$out_dir"
  new_tmpdir; tmp=$TMPD
  CLEANUP_PATHS+=("$out.part")

  if [[ -z "$(site_compose ps --status running -q db 2>/dev/null)" ]]; then
    info "Database đang dừng, khởi động tạm để dump..."
    site_compose --progress quiet up -d db
    started_db=1
  fi
  wait_db_healthy

  info "Dump database $SITE_DOMAIN..."
  # shellcheck disable=SC2016
  site_compose exec -T db sh -c 'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" \
      --single-transaction --quick --routines --triggers --events \
      --default-character-set=utf8mb4 "$MARIADB_DATABASE"' >"$tmp/db.sql"
  (( started_db )) && site_compose stop db >/dev/null 2>&1

  cp -p "$SITE_DIR/site.conf" "$SITE_DIR/.env" "$SITE_DIR/nginx.conf" "$SITE_DIR/php.ini" "$tmp/"
  [[ -f "$SITE_DIR/compose.le.yml" ]] && cp -p "$SITE_DIR/compose.le.yml" "$tmp/"
  if [[ "$SITE_SSL" == origin && -f "$PROXY_DIR/certs/$SITE_DOMAIN.crt" ]]; then
    mkdir -p "$tmp/certs"
    cp -p "$PROXY_DIR/certs/$SITE_DOMAIN.crt" "$PROXY_DIR/certs/$SITE_DOMAIN.key" "$tmp/certs/"
  fi
  echo "$DATVPS_VERSION" >"$tmp/DATVPS_VERSION"

  info "Nén mã nguồn + dữ liệu..."
  (umask 077; tar -czf "$out.part" \
    --exclude='wordpress/wp-content/cache' \
    --exclude='wordpress/wp-content/upgrade' \
    -C "$tmp" . -C "$SITE_DIR" wordpress)
  mv "$out.part" "$out"
  chmod 600 "$out"
  rm -rf "$tmp"
  prune_backups "$out_dir"
  BACKUP_FILE=$out
  ok "Backup $SITE_DOMAIN: $out ($(du -h "$out" | cut -f1))"
}

prune_backups() {
  local dir=$1 keep=$((KEEP_BACKUPS > 0 ? KEEP_BACKUPS : 1))
  find "$dir" -maxdepth 1 -type f -name '*.tar.gz' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((keep + 1)) | cut -d' ' -f2- \
    | while IFS= read -r f; do rm -f -- "$f"; done
}

cmd_backup() {
  local target="" quiet=0
  while (($#)); do
    case $1 in
      --quiet) quiet=1 ;;
      -*) die "Tuỳ chọn không hợp lệ: $1" ;;
      *) target=$1 ;;
    esac
    shift
  done
  require_root
  need_docker
  [[ -n "$target" ]] || die "Cách dùng: dat backup <site|all>"
  (( quiet )) && DATVPS_QUIET=1
  if [[ "$target" != all ]]; then
    backup_site "$(site_resolve "$target")"
    (( quiet )) && echo "$(date '+%F %T') backup $SITE_ID: OK $BACKUP_FILE"
    return 0
  fi
  local id failed=0 args=()
  (( quiet )) && args=(--quiet)
  for id in $(site_ids); do
    # Mỗi site chạy trong 1 tiến trình riêng: site lỗi không làm dừng site khác
    if ! "$DATVPS_HOME/bin/dat" backup "$id" "${args[@]}"; then
      warn "Backup thất bại: $id"
      (( quiet )) && echo "$(date '+%F %T') backup $id: FAILED"
      failed=1
    fi
  done
  return "$failed"
}

cmd_backups() {
  local target=${1:-} id
  if [[ -n "$target" ]]; then id=$(site_resolve "$target"); fi
  local dir="$BACKUP_DIR${id:+/$id}"
  [[ -d "$dir" ]] || { echo "Chưa có backup."; return 0; }
  find "$dir" -type f -name '*.tar.gz' -printf '%TY-%Tm-%Td %TH:%TM  %10s  %p\n' | sort -r \
    | awk '{ s=$3; u="B"; if (s>1024){s/=1024;u="K"} if (s>1024){s/=1024;u="M"} if (s>1024){s/=1024;u="G"}
             printf "%s %s  %7.1f%s  %s\n", $1, $2, s, u, $4 }'
}

# dat restore <file.tar.gz> [site]
#   - Không có [site]: khôi phục về đúng site trong backup (tạo lại nếu đã bị xoá).
#   - Có [site]: ghi đè vào site đó (tự search-replace nếu khác domain).
cmd_restore() {
  local file="" target=""
  while (($#)); do
    case $1 in
      -y|--yes) DATVPS_YES=1 ;;
      -*) die "Tuỳ chọn không hợp lệ: $1" ;;
      *) if [[ -z "$file" ]]; then file=$1; elif [[ -z "$target" ]]; then target=$1; else die "Thừa tham số: $1"; fi ;;
    esac
    shift
  done
  require_root
  need_docker
  [[ -n "$file" ]] || die "Cách dùng: dat restore <file.tar.gz> [site]"
  # Cho phép viết ngược: dat restore <site> <file>
  if [[ ! -f "$file" && -n "$target" && -f "$target" ]]; then local t=$file; file=$target; target=$t; fi
  [[ -f "$file" ]] || die "Không thấy file: $file"

  local tmp
  new_tmpdir; tmp=$TMPD
  info "Giải nén backup..."
  tar -xzf "$file" -C "$tmp"
  [[ -f "$tmp/site.conf" && -f "$tmp/db.sql" && -d "$tmp/wordpress" ]] || die "File không phải backup datvps hợp lệ."

  local src_id src_domain src_ssl id
  src_id=$(conf_get "$tmp/site.conf" ID)
  src_domain=$(conf_get "$tmp/site.conf" DOMAIN)
  src_ssl=$(conf_get "$tmp/site.conf" SSL)
  valid_id "$src_id" || die "ID trong backup không hợp lệ."

  if [[ -n "$target" ]]; then
    id=$(site_resolve "$target")
  else
    id=$src_id
  fi

  if [[ -f "$SITES_DIR/$id/site.conf" ]]; then
    site_load "$id"
    confirm "Ghi đè toàn bộ dữ liệu của $SITE_DOMAIN bằng backup của $src_domain?" || die "Đã huỷ."
    info "Sao lưu an toàn trạng thái hiện tại trước khi ghi đè..."
    backup_site "$id"
    site_load "$id"
    site_compose stop web php
  else
    domain_in_use "$src_domain" && die "Domain $src_domain đang được site khác dùng. Hãy chỉ định site đích."
    docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1 || die "Chưa có proxy. Chạy: sudo dat setup"
    info "Tạo lại site $src_domain ($id) từ backup..."
    install -d -m 700 "$SITES_DIR/$id" "$SITES_DIR/$id/db"
    local f
    for f in site.conf .env nginx.conf php.ini compose.le.yml; do
      [[ -f "$tmp/$f" ]] && cp -p "$tmp/$f" "$SITES_DIR/$id/"
    done
    install -m 644 "$DATVPS_HOME/templates/wordpress/compose.yml" "$SITES_DIR/$id/compose.yml"
    chmod 600 "$SITES_DIR/$id/.env" "$SITES_DIR/$id/site.conf"
    if [[ -d "$tmp/certs" ]]; then
      install -d -m 755 "$PROXY_DIR/certs"
      cp -p "$tmp/certs/"* "$PROXY_DIR/certs/"
    fi
    site_load "$id"
  fi

  # Giữ prefix bảng giống backup (wp-config đọc từ .env)
  conf_set "$SITE_DIR/.env" DB_PREFIX "$(conf_get "$tmp/.env" DB_PREFIX)"

  info "Khôi phục mã nguồn..."
  rm -rf "$SITE_DIR/wordpress.restoring"
  mv "$tmp/wordpress" "$SITE_DIR/wordpress.restoring"
  rm -rf "$SITE_DIR/wordpress"
  mv "$SITE_DIR/wordpress.restoring" "$SITE_DIR/wordpress"
  fix_perms

  info "Khôi phục database..."
  site_compose up -d db
  wait_db_healthy
  local db user
  db=$(conf_get "$SITE_DIR/.env" DB_NAME)
  user=$(conf_get "$SITE_DIR/.env" DB_USER)
  db_exec_root -e "DROP DATABASE IF EXISTS \`$db\`; CREATE DATABASE \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`$db\`.* TO '$user'@'%'; FLUSH PRIVILEGES;"
  db_exec_root "$db" <"$tmp/db.sql"

  site_compose up -d
  if [[ "$src_domain" != "$SITE_DOMAIN" ]]; then
    info "Đổi domain trong database: $src_domain → $SITE_DOMAIN..."
    local pair from to
    for pair in "//www.$src_domain|//www.$SITE_DOMAIN" "//$src_domain|//$SITE_DOMAIN" \
                "\\/\\/www.$src_domain|\\/\\/www.$SITE_DOMAIN" "\\/\\/$src_domain|\\/\\/$SITE_DOMAIN"; do
      from=${pair%%|*} to=${pair#*|}
      site_wp search-replace "$from" "$to" --all-tables-with-prefix --skip-columns=guid --precise --quiet
    done
  fi
  if [[ "$src_ssl" != "$SITE_SSL" || "$src_domain" != "$SITE_DOMAIN" ]]; then
    site_wp option update home "$(site_url)" >/dev/null
    site_wp option update siteurl "$(site_url)" >/dev/null
  fi
  site_wp cache flush >/dev/null 2>&1 || true
  ok "Đã khôi phục $SITE_DOMAIN từ $(basename "$file")"
}

cmd_cron() {
  local mode=${1:-status} f=/etc/cron.d/datvps
  case $mode in
    on)
      require_root
      cat >"$f" <<EOF
# datvps - backup tất cả site lúc 03:30 hằng ngày, giữ $KEEP_BACKUPS bản mỗi site
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root /usr/local/bin/dat backup all --quiet >>/var/log/datvps-backup.log 2>&1
EOF
      chmod 644 "$f"
      ok "Đã bật backup tự động 03:30 hằng ngày (log: /var/log/datvps-backup.log)" ;;
    off)
      require_root
      rm -f "$f"
      ok "Đã tắt backup tự động" ;;
    status)
      if [[ -f "$f" ]]; then echo "Backup tự động: BẬT (03:30 hằng ngày, giữ $KEEP_BACKUPS bản)"; else echo "Backup tự động: TẮT"; fi ;;
    *) die "Cách dùng: dat cron on|off|status" ;;
  esac
}
