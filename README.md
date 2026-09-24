# datvps

Quản lý **nhiều site WordPress trên một VPS Ubuntu** bằng Docker. Mỗi site được **cô lập hoàn toàn**
(database, Redis, network, mã nguồn riêng): một site bị hack không lây sang site khác.
Mọi thao tác chỉ qua một lệnh: **`dat`**.

## Cài đặt (VPS Ubuntu 22.04 / 24.04 trắng)

```bash
curl -fsSL https://raw.githubusercontent.com/datjbl932-web/buivandat/main/install.sh | sudo bash
```

Lệnh trên sẽ:

1. Tải datvps về `/opt/datvps`
2. Cài Docker + docker compose (log tự xoay vòng 10MB × 3)
3. Bật UFW: chỉ mở SSH (tự nhận cổng), 80, 443
4. Tạo swap 2GB nếu RAM < 2GB
5. Chạy front proxy: **nginx-proxy + acme-companion** (Let's Encrypt tự động)
6. Cài lệnh `dat` vào `/usr/local/bin`
7. Bật backup tự động lúc 03:30 hằng ngày
8. Hỏi tạo site đầu tiên

Tuỳ chọn: `... | sudo bash -s -- --email you@gmail.com --no-swap`
(các cờ: `--email`, `--no-ufw`, `--no-swap`, `--no-cron`). Chạy lại nhiều lần vẫn an toàn.

## Kiến trúc

```
Internet ─► (Cloudflare) ─► nginx-proxy + acme-companion   :80 / :443   (network chung: datvps_proxy)
                              │  route theo domain (VIRTUAL_HOST)
               ┌──────────────┼───────────────────┐
          site A           site B              site C        mỗi site = 1 docker compose project
     ┌─────────────┐   ┌─────────────┐
     │ web (nginx) │◄──┤ chỉ web nối │  network "backend" riêng của từng site:
     │ php-fpm     │   │ ra proxy    │  php, MariaDB, Redis KHÔNG chạm network chung
     │ MariaDB     │   └─────────────┘  → site A không thể thấy DB / Redis của site B
     │ Redis       │
     └─────────────┘
```

- Mỗi container: `no-new-privileges`, giới hạn RAM (`mem_limit`), log xoay vòng.
- DB/Redis/WordPress mỗi site có mật khẩu ngẫu nhiên riêng (32 ký tự).
- Thêm/xoá site không cần sửa cấu hình proxy.
- **ID site bất biến** (vd `blog-com-3f2a`) → đổi domain không cần tạo lại container.

## Dùng hằng ngày

```bash
dat                                   # menu TUI (mũi tên + Enter)
dat add blog.com --email you@gmail.com --www          # HTTPS Let's Encrypt tự động
dat add shop.vn --ssl origin --cert shop.pem --key shop.key   # Cloudflare Origin Cert
dat ls                                # danh sách site + trạng thái
dat info blog.com                     # thông tin chi tiết
dat domain blog.com blog-moi.com      # đổi domain, giữ nguyên dữ liệu
dat wp blog.com plugin list           # chạy wp-cli bất kỳ
dat logs blog.com php                 # log: web | php | db | redis
dat restart blog.com                  # start | stop | restart  <site|all>
dat backup all                        # backup mọi site
dat backups blog.com                  # liệt kê backup
dat restore /opt/backups/<id>/<file>.tar.gz [site-đích]
dat rm blog.com                       # xoá (tự backup lần cuối)
dat status                            # tình trạng VPS, proxy, site
dat update                            # cập nhật datvps (git pull)
dat upgrade                           # cập nhật OS + image Docker
```

`<site>` là **ID hoặc domain** (chấp nhận cả `www.` hoặc URL đầy đủ).
Thêm `--yes` để bỏ qua câu hỏi xác nhận (dùng trong script).

### Tạo site: `dat add`

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--ssl auto` | Let's Encrypt tự động (mặc định). Domain phải trỏ thẳng về IP VPS, hoặc Cloudflare ở chế độ DNS-only (đám mây xám) |
| `--ssl origin` | Cloudflare Origin Certificate. Tạo ở Cloudflare → SSL/TLS → Origin Server, bật proxy (đám mây cam), SSL/TLS = **Full (strict)**. Không truyền `--cert/--key` thì dán trực tiếp |
| `--ssl none` | Chỉ HTTP (để thử nghiệm) |
| `--www` | Phục vụ thêm `www.<domain>` (WordPress tự chuyển hướng về domain chính) |
| `--php 8.1…8.4` | Phiên bản PHP (mặc định 8.3) |
| `--title`, `--admin-user`, `--admin-email` | Thông tin WordPress |

Sau khi tạo, tài khoản admin (ngẫu nhiên, mạnh) được in ra màn hình và lưu tại
`/opt/sites/<id>/credentials.txt` (chỉ root đọc được).

Site mới có sẵn: permalink `/%postname%/`, múi giờ `Asia/Ho_Chi_Minh`, plugin **Redis Object Cache**
đã bật, quyền file chuẩn (cài plugin/theme/upload trong wp-admin chạy ngay, không đòi FTP).

### Backup & khôi phục

- Backup gồm: dump database + toàn bộ mã nguồn WordPress + cấu hình site (+ origin cert nếu có),
  nén `.tar.gz` tại `/opt/backups/<id>/`, quyền 600. Mặc định giữ **7 bản** mới nhất mỗi site.
- Backup tự động: `dat cron on|off|status` (log: `/var/log/datvps-backup.log`).
- `dat restore <file>`: khôi phục về đúng site gốc. Nếu site đã bị xoá, datvps **tạo lại** site.
- `dat restore <file> <site-khác>`: nhân bản / chuyển dữ liệu sang site khác,
  **tự search-replace domain** trong database.
- Trước khi ghi đè hoặc đổi domain, datvps luôn tạo một bản backup an toàn.

**Chuyển sang VPS mới:** cài datvps trên VPS mới, copy file backup sang rồi chạy
`dat restore <file>`, sau đó trỏ DNS về IP mới.

## Bảo mật mặc định

- Chặn truy cập `wp-config.php`, `xmlrpc.php`, `readme.html`, file ẩn (`.env`, `.git`...).
- Không cho chạy PHP trong `wp-content/uploads`.
- `DISALLOW_FILE_EDIT` (tắt sửa code trong wp-admin), tự cập nhật bản vá WordPress core.
- Lấy IP thật của khách qua proxy nội bộ và dải IP Cloudflare.
- File `.env`, `site.conf`, `credentials.txt` và backup chỉ root đọc được.

> Cần XML-RPC (Jetpack, app di động)? Sửa `/opt/sites/<id>/nginx.conf`, bỏ `xmlrpc\.php`
> khỏi dòng chặn, rồi chạy `dat restart <site>`.

## Cấu trúc thư mục trên VPS

```
/opt/datvps/            mã nguồn datvps (git)  →  /usr/local/bin/dat
/etc/datvps.conf        cấu hình chung (email, thư mục, số bản backup giữ lại...)
/opt/sites/<id>/        mỗi site:
    site.conf             ID, domain, chế độ SSL
    .env                  mật khẩu + biến docker compose (KHÔNG chia sẻ)
    compose.yml           stack: web, php, db, redis (+ cli cho wp-cli)
    nginx.conf  php.ini   có thể tuỳ chỉnh riêng từng site
    wordpress/            mã nguồn WordPress
    db/                   dữ liệu MariaDB
/opt/proxy/             certs/ (Let's Encrypt + origin), vhost.d/, acme/
/opt/backups/<id>/      các bản backup
```

Tuỳ chỉnh RAM mỗi site: sửa `MEM_DB`, `MEM_PHP`, `MEM_WEB`, `MEM_REDIS` trong `/opt/sites/<id>/.env`
rồi `dat restart <site>`.

## Phát triển

```bash
tests/run.sh      # cú pháp bash, shellcheck, unit test, kiểm tra docker compose config
```

Cấu trúc mã nguồn:

```
install.sh           bộ cài 1 lệnh
bin/dat              điểm vào CLI
lib/common.sh        cấu hình, log, validate, tiện ích site
lib/setup.sh         cài Docker / UFW / swap / proxy
lib/site.sh          add, ls, info, domain, start/stop, logs, wp, rm
lib/backup.sh        backup, restore, cron
lib/system.sh        update, upgrade, status
lib/menu.sh          menu TUI (whiptail)
templates/wordpress/ compose + nginx + php.ini cho mỗi site
proxy/               compose front proxy
```

## Giấy phép

[MIT](LICENSE) © 2026 datvps
