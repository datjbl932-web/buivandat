# DatCrawl

API crawl dữ liệu **tự host**, thay cho Crawlbase. Gọi API giống hệt Crawlbase (`?token=…&url=…&scraper=…`), nên code đang dùng Crawlbase chỉ cần đổi địa chỉ máy chủ.

| Tính năng | Chi tiết |
|---|---|
| **Crawling API** | Gửi URL, nhận HTML hoặc JSON. Có header `original_status` / `pc_status` như Crawlbase. |
| **Scraper Amazon** | `amazon-product-details`, `amazon-serp`, `amazon-best-sellers`, cùng `generic` cho mọi website. `scraper=auto` tự nhận diện. |
| **Proxy xoay vòng** | Chấm điểm sức khoẻ từng proxy. Proxy bị Amazon chặn sẽ tạm nghỉ (30 giây đến 30 phút). Mỗi proxy giữ cookie phiên riêng, request cách nhau theo từng tên miền. |
| **Tự thử lại** | Nhận biết CAPTCHA của Amazon, lỗi 503, trang chặn của Cloudflare/PerimeterX, rồi đổi proxy và thử lại. |
| **Job hàng loạt** | Gửi tối đa 10.000 URL một lần, xử lý nền, kết quả gửi về webhook (có chữ ký HMAC). Tải kết quả dạng CSV/JSON. |
| **Cache** | Cùng một URL không phải tải lại trong thời gian `CACHE_TTL_SEC`. |
| **Quản lý khách hàng** | Nhiều API token, mỗi token có giới hạn request/phút và hạn mức tháng riêng, kèm thống kê sử dụng. |
| **Dashboard** | Xem thống kê, thử crawl, quản lý job, tài liệu API, tạo token, xem sức khoẻ proxy. |
| **An toàn** | Chặn crawl vào mạng nội bộ (SSRF). Token chỉ lưu dạng băm. Mật khẩu proxy được che trong dashboard. |

## ⚠️ Đọc trước khi dùng

1. **Proxy là phần tốn tiền nhất, không phải phần mềm.** Amazon chặn IP của VPS và proxy datacenter rất nhanh. Muốn crawl ổn định cần **proxy dân cư (residential)**, thường 1–5 USD/GB. Tham khảo mức dùng: một trang sản phẩm Amazon nặng khoảng 0,5–1,5 MB.
2. **Không có giải CAPTCHA.** Khi gặp CAPTCHA, hệ thống đổi proxy và thử lại. Nếu tỉ lệ bị chặn cao, hãy dùng proxy tốt hơn, tăng `PER_PROXY_DELAY_MS` hoặc giảm `CONCURRENCY`.
3. **Amazon có thể đổi giao diện bất cứ lúc nào**, khiến một vài trường bị trống. Chạy `datcrawl selftest` để kiểm tra (xem bên dưới). Bộ chọn (selector) nằm trong `src/scrapers/amazon/`.
4. **Điều khoản sử dụng:** Điều khoản của Amazon không cho phép thu thập dữ liệu tự động. Hãy chỉ lấy dữ liệu công khai, crawl với tốc độ vừa phải, không thu thập thông tin cá nhân, và tự chịu trách nhiệm về cách dùng dữ liệu.

## Cài đặt trên VPS (Docker – khuyên dùng)

```bash
git clone https://github.com/datjbl932-web/buivandat.git
cd buivandat/crawler

cp .env.example .env
nano .env                      # đổi ADMIN_TOKEN thành chuỗi dài, ngẫu nhiên
cp proxies.example.txt proxies.txt
nano proxies.txt               # dán danh sách proxy, mỗi dòng một proxy

mkdir -p data && sudo chown 1000:1000 data   # container chạy bằng user không phải root (uid 1000)
docker compose up -d --build
docker compose exec datcrawl node bin/datcrawl.js create-token "Tên của bạn"   # in ra API token
docker compose exec datcrawl node bin/datcrawl.js selftest                     # thử crawl Amazon thật
```

Dashboard ở địa chỉ `http://IP-VPS:8080/dashboard/`. Mặc định chỉ mở trong máy (`127.0.0.1`), nên muốn truy cập từ bên ngoài cần đặt HTTPS phía trước như bên dưới.

### HTTPS bằng Caddy (ví dụ `crawl.buivandat.com`)

1. Tạo bản ghi DNS `A`: `crawl` trỏ về IP của VPS.
2. Cài [Caddy](https://caddyserver.com/docs/install), rồi ghi vào `/etc/caddy/Caddyfile`:

   ```
   crawl.buivandat.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

3. Chạy `sudo systemctl reload caddy`. Caddy tự lấy chứng chỉ HTTPS miễn phí.

### Không dùng Docker

Cần Node.js 20 trở lên.

```bash
cd crawler
npm ci --omit=dev
cp .env.example .env && cp proxies.example.txt proxies.txt   # rồi sửa như trên
node bin/datcrawl.js create-token "Tên của bạn"
npm start                      # hoặc: pm2 start src/server.js --name datcrawl
```

## Dùng API

```bash
# HTML gốc
curl "https://crawl.buivandat.com/?token=dc_xxx&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0BKW3LB2B"

# JSON sản phẩm
curl "https://crawl.buivandat.com/?token=dc_xxx&scraper=amazon-product-details&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0BKW3LB2B"
```

| Tham số | Ý nghĩa |
|---|---|
| `token` | API token. Có thể thay bằng header `Authorization: Bearer dc_xxx`. |
| `url` | URL cần crawl, đã mã hoá URL. |
| `scraper` | `auto`, `amazon-product-details`, `amazon-serp`, `amazon-best-sellers`, `generic`. Bỏ trống thì trả về HTML. |
| `format` | `html` (mặc định khi không có scraper) hoặc `json`. |
| `cache` | `false` để luôn tải mới. |
| `retries` | Số lần thử lại khi bị chặn (0–8, mặc định `MAX_RETRIES`). |
| `javascript` | `true` để mở trang bằng trình duyệt thật. Cần `ENABLE_JS=true` và đã cài Playwright. |

Kết quả JSON có dạng:

```json
{
  "original_status": 200,
  "pc_status": 200,
  "url": "https://www.amazon.com/dp/B0BKW3LB2B",
  "body": { "asin": "B0BKW3LB2B", "name": "…", "price": 99.99, "currency": "USD", "rating": 4.6, "reviewsCount": 12483, "…": "…" },
  "attempts": 2,
  "blocks": [{ "proxy": "http://…", "reason": "captcha" }]
}
```

Các giá trị `pc_status`:

| Mã | Ý nghĩa |
|---|---|
| `200` | Thành công. `original_status` là mã HTTP của trang gốc, có thể là 404. |
| `400` | URL hoặc scraper không hợp lệ. |
| `401` | Token sai. |
| `429` | Vượt giới hạn request/phút hoặc hết hạn mức tháng. |
| `520` | Tải thất bại hoặc bị chặn ở mọi lần thử. |
| `525` | Tải được trang nhưng phân tích thất bại. |

### Các trường dữ liệu Amazon

- **`amazon-product-details`:** `asin, name, brand, price, listPrice, currency, rating, reviewsCount, availability, inStock, isPrime, seller, mainImage, images[], features[], description, breadcrumbs[], bestSellersRank[], productInformation[]`
- **`amazon-serp`:** `query, totalResults, nextPage, products[]`. Mỗi sản phẩm có `position, asin, name, url, image, price, listPrice, rating, reviewsCount, isPrime, sponsored`.
- **`amazon-best-sellers`:** `category, nextPage, products[]`. Mỗi sản phẩm có `rank, asin, name, url, image, price, rating, reviewsCount`.

Giá đọc đúng định dạng của từng chợ: `$1,299.99`, `1.299,99 €`, `￥3,980`, `₹1,49,999`. Chợ dùng đồng đô la (.ca, .com.au, .com.mx) trả về đúng mã tiền tệ.

### Job hàng loạt

```bash
curl -X POST https://crawl.buivandat.com/api/jobs \
  -H "Authorization: Bearer dc_xxx" -H "Content-Type: application/json" \
  -d '{"urls": ["https://www.amazon.com/dp/B0BKW3LB2B", "https://www.amazon.com/s?k=ssd"], "scraper": "auto", "callback_url": "https://may-chu-cua-ban/webhook"}'

curl -H "Authorization: Bearer dc_xxx" https://crawl.buivandat.com/api/jobs/job_xxx       # tiến độ + kết quả (?offset=&limit=)
curl -X DELETE -H "Authorization: Bearer dc_xxx" https://crawl.buivandat.com/api/jobs/job_xxx   # huỷ job
```

Webhook nhận `POST` JSON cho từng URL, kèm header `X-DatCrawl-Signature: sha256=<HMAC-SHA256 của body, khoá là webhook_secret>`. Xem `webhook_secret` ở `/api/account` hoặc trên dashboard.

### Quản trị

Gọi kèm header `Authorization: Bearer <ADMIN_TOKEN>`:

| API | Việc |
|---|---|
| `GET /admin/tokens` | Danh sách token. |
| `POST /admin/tokens` | Tạo token. Gửi `{"name", "rate_limit", "monthly_quota"}`. |
| `POST /admin/tokens/:id/disable` | Khoá token. |
| `GET /admin/proxies` | Sức khoẻ proxy. |
| `GET /admin/stats` | Thống kê chung. |

## Kiểm tra với Amazon thật: `selftest`

```bash
node bin/datcrawl.js selftest                                   # 3 URL mẫu: sản phẩm, tìm kiếm, best sellers
node bin/datcrawl.js selftest https://www.amazon.de/dp/B0XXXXXXX # URL tuỳ chọn
```

Lệnh này in ra số lần thử, proxy nào bị chặn, các trường bị trống và một phần dữ liệu đã lấy được. Nếu một trường quan trọng luôn trống, giao diện Amazon đã đổi: lưu HTML trang đó lại và sửa bộ chọn trong `src/scrapers/amazon/`.

## Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 8080 | Cổng chạy. |
| `ADMIN_TOKEN` | – | Mật khẩu quản trị. |
| `PROXIES_FILE` / `PROXIES` | `./proxies.txt` / – | Danh sách proxy. |
| `USE_DIRECT` | false | Cho phép gọi thẳng từ IP máy chủ. |
| `CONCURRENCY` | 10 | Số request đồng thời toàn hệ thống. |
| `PER_DOMAIN_CONCURRENCY` | 4 | Số request đồng thời cho mỗi tên miền. |
| `PER_PROXY_DELAY_MS` | 1500 | Thời gian nghỉ giữa 2 request cùng proxy, cùng tên miền. |
| `MAX_RETRIES` | 4 | Số lần thử lại. |
| `TIMEOUT_MS` | 30000 | Thời gian chờ mỗi lần tải. |
| `CACHE_TTL_SEC` | 3600 | Thời gian giữ cache (0 = tắt). |
| `DEFAULT_RATE_LIMIT` | 60 | Số request/phút mặc định của mỗi token. |
| `JOB_WORKERS` | 4 | Số tiến trình xử lý job hàng loạt. |
| `ENABLE_JS` | false | Bật trình duyệt thật cho `javascript=true`. |

## Phát triển

```bash
npm install
npm test        # kiểm thử scraper + kiểm thử đầu-cuối (Amazon giả lập, proxy giả, webhook), không cần Internet
npm run dev
```

Cấu trúc mã nguồn:

```
src/server.js          API + dashboard (Fastify)
src/fetcher.js         tải trang: chọn proxy, thử lại, theo chuyển hướng, giới hạn dung lượng
src/proxies.js         kho proxy xoay vòng, chấm điểm, tạm nghỉ khi bị chặn, cookie theo proxy
src/detect.js          nhận biết CAPTCHA / trang chặn
src/crawl.js           cache -> tải -> phân tích
src/jobs.js            job hàng loạt + webhook HMAC
src/netguard.js        chống SSRF
src/scrapers/          scraper Amazon + generic
bin/datcrawl.js        CLI: tạo token, selftest
public/                dashboard
```
