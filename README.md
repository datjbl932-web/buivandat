# buivandat.com

Website của **buivandat.com** – nơi Đạt chia sẻ tin tức, phần mềm và kinh nghiệm MMO.

Website dùng **Jekyll**, GitHub Pages tự động build mỗi khi có thay đổi – bạn không cần cài gì.

## ✍️ Cách đăng bài mới

1. Mở thư mục `_drafts/`, copy nội dung file `bai-viet-mau.md`.
2. Tạo file mới trong thư mục `_posts/`, đặt tên theo dạng `NĂM-THÁNG-NGÀY-duong-dan.md`,
   ví dụ `2026-10-05-huong-dan-bat-dau-affiliate.md`.
   Bạn có thể làm ngay trên github.com: vào `_posts/` → **Add file → Create new file**.
3. Sửa phần đầu file (tiêu đề, ngày, chuyên mục, mô tả), rồi viết nội dung bằng Markdown.
4. Bấm **Commit** – khoảng 1 phút sau bài sẽ xuất hiện ở `buivandat.com/blog/duong-dan/`.

Chuyên mục (`category`): `tin-tuc`, `phan-mem`, `kinh-nghiem` (tên và mô tả khai báo trong `_data/categories.yml`).
Ảnh chân dung ở mục "Về mình": đặt ảnh vào `assets/img/` và điền `photo:` trong `_config.yml`.
Ảnh bìa không bắt buộc – đặt ảnh vào `assets/img/posts/` và thêm dòng `cover: /assets/img/posts/ten-anh.jpg`.
Bài có ngày trong tương lai sẽ chưa được đăng cho tới ngày đó.

## 🔎 SEO & ảnh khi chia sẻ link

- Mỗi trang tự có: tiêu đề, mô tả, link chuẩn (canonical), thẻ Open Graph/Twitter cho Facebook, Zalo, Telegram, X, và dữ liệu cấu trúc (JSON-LD) cho Google. Tất cả nằm trong `_includes/seo.html`.
- **Ảnh chia sẻ riêng cho từng bài** (1200×630) nằm ở `assets/img/og/<đường-dẫn-bài>.png`. Bài nào chưa có ảnh riêng thì dùng ảnh mặc định `assets/img/og-image.png`.
- Tạo ảnh cho bài mới (cần Node.js):

  ```bash
  npm install --no-save playwright && npx playwright install chromium
  node scripts/og-images.js        # chỉ tạo ảnh cho bài chưa có
  node scripts/og-images.js --all  # tạo lại tất cả
  ```

- Tuỳ chọn trong phần đầu bài: `seo_title` (tiêu đề ngắn cho Google, khoảng 60 ký tự), `og_title` (tiêu đề trên ảnh chia sẻ), `og_icon` (biểu tượng trên ảnh chia sẻ), `cover` (ảnh bìa đầu bài).
- Xác minh với Google Search Console / Bing: điền mã vào mục `verification` trong `_config.yml`.
- Kiểm tra link chia sẻ: [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) (bấm *Scrape Again* để Facebook lấy ảnh mới).

## Cấu trúc

```
index.html              Trang chủ
blog/index.html         Trang danh sách bài viết (lọc chuyên mục, tìm kiếm)
_posts/                 Bài viết (Markdown)
_drafts/                Bài viết mẫu / bản nháp (không đăng)
_layouts/, _includes/   Khung giao diện dùng chung (header, footer, bài viết)
_data/categories.yml    Danh sách chuyên mục
_config.yml             Cấu hình website
assets/css, js, img     Giao diện, script, logo & ảnh
404.html                Trang báo lỗi không tìm thấy
```

Tự động có: `feed.xml` (RSS), `sitemap.xml` và thẻ SEO cho từng trang.

## Xem thử trên máy (không bắt buộc)

```bash
bundle install
bundle exec jekyll serve
# mở http://localhost:4000
```

## Đưa lên mạng (GitHub Pages)

1. Repo → **Settings → Pages** → Source: `Deploy from a branch`, chọn nhánh `main`, thư mục `/ (root)`.
2. Ở nhà cung cấp tên miền, trỏ DNS:
   - 4 bản ghi `A` cho `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Bản ghi `CNAME` cho `www` → `datjbl932-web.github.io`
3. Quay lại **Settings → Pages**, bật **Enforce HTTPS**.
