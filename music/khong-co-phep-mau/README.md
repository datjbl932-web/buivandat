# Không Có Phép Màu

Bài hát và music video của buivandat.com, viết hoàn toàn bằng code.
Bài giới thiệu: https://buivandat.com/blog/khong-co-phep-mau-bai-hat-viet-bang-code/

| File | Việc |
|---|---|
| `compose.py` | Soạn nhạc: lời, hợp âm, giai điệu theo thanh điệu tiếng Việt, phối khí, mix (kèm giọng hát nếu có `build/vocal.wav`) → `build/song.wav` + `build/song.json` |
| `sing.py` | Giọng hát nam: Piper TTS đọc liền cả câu (ranh giới chữ dò bằng DTW) → WORLD dựng lại thành câu hát (ngân nguyên âm, luyến có đà, rung, luyến láy theo dấu, nhấn nhá, lấy hơi, mở rộng dải cao) → `build/vocal.wav` |
| `../../assets/media/khong-co-phep-mau/scene.js` | Vẽ video: mỗi khung hình là một hàm của thời gian bài hát (dùng chung cho bản MP4 và trang `/nhac/khong-co-phep-mau/`) |
| `render.html`, `render.js` | Xuất MP4 1080p30 bằng Chromium (Playwright) + ffmpeg |

## Chạy lại

```bash
pip install numpy scipy pyworld piper-tts
# giọng đọc (CC BY-NC-SA 4.0): https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-vi-vivos-x-low.tar.gz
python3 sing.py --model vi-vivos-x-low.onnx --speaker 57   # → build/vocal.wav
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

Giọng hát được tạo từ mô hình huấn luyện trên bộ dữ liệu VIVOS (CC BY-NC-SA 4.0),
vì vậy bài hát được chia sẻ theo CC BY-NC-SA 4.0: ghi nguồn, phi thương mại, chia sẻ cùng giấy phép.
