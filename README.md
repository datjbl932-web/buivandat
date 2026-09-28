# buivandat.com

Trang chủ của **buivandat.com** – nơi Đạt chia sẻ tin tức, phần mềm và kinh nghiệm MMO.

Website tĩnh (HTML/CSS/JS thuần), không cần build.

## Cấu trúc

```
index.html              Trang chủ
favicon.svg / .ico      Favicon
site.webmanifest        Icon khi thêm vào màn hình điện thoại
CNAME                   Tên miền cho GitHub Pages
assets/css/style.css    Giao diện
assets/css/fonts.css    Font Be Vietnam Pro (tự host)
assets/js/main.js       Menu mobile, hiệu ứng, form liên hệ (mailto)
assets/img/             Logo, icon, ảnh chia sẻ mạng xã hội (og-image.png)
```

## Xem thử trên máy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Đưa lên mạng (GitHub Pages)

1. Repo → **Settings → Pages** → Source: `Deploy from a branch`, chọn nhánh chứa code, thư mục `/ (root)`.
2. Ở nhà cung cấp tên miền, trỏ DNS:
   - 4 bản ghi `A` cho `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Bản ghi `CNAME` cho `www` → `datjbl932-web.github.io`
3. Quay lại **Settings → Pages**, bật **Enforce HTTPS**.
