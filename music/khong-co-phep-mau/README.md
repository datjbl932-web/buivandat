# Không Có Phép Màu

Bài hát và music video của buivandat.com, viết hoàn toàn bằng code.
Bài giới thiệu: https://buivandat.com/blog/khong-co-phep-mau-bai-hat-viet-bang-code/

| File | Việc |
|---|---|
| `compose.py` | Soạn nhạc: lời, hợp âm, giai điệu theo thanh điệu tiếng Việt, phối khí, mix → `build/song.wav` + `build/song.json` |
| `../../assets/media/khong-co-phep-mau/scene.js` | Vẽ video: mỗi khung hình là một hàm của thời gian bài hát (dùng chung cho bản MP4 và trang `/nhac/khong-co-phep-mau/`) |
| `render.html`, `render.js` | Xuất MP4 1080p30 bằng Chromium (Playwright) + ffmpeg |

## Chạy lại

```bash
pip install numpy scipy
python3 compose.py                                   # → build/song.wav, build/song.json
cp build/song.json ../../assets/media/khong-co-phep-mau/

# ở thư mục gốc repo, mở một terminal khác:
python3 -m http.server 8770

npm install --no-save playwright && npx playwright install chromium
node render.js stills 8.6 40 60                      # ảnh thử
node render.js video --out build/video.mp4           # xuất video (~2 phút)
```

Cách làm lấy cảm hứng từ [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) (MIT).
Không dùng lại nhạc, lời hay hình ảnh của dự án đó.
