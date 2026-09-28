---
title: "Không Có Phép Màu: bài hát và music video viết hoàn toàn bằng code"
seo_title: "Không Có Phép Màu – bài hát & MV viết bằng code | buivandat.com"
date: 2026-09-28 11:45:00 +0700
category: am-nhac
description: "Bài hát đầu tiên của buivandat.com, giọng nam: nhạc, giai điệu, giọng hát và video đều được tạo bằng code. Lời nói về kiếm tiền online không có phép màu, chỉ có kỷ luật, công cụ và thông tin đúng."
image:
  path: /assets/media/khong-co-phep-mau/og.jpg
  width: 1200
  height: 630
  alt: "Khung hình music video Không Có Phép Màu"
cover: /assets/media/khong-co-phep-mau/poster.jpg
cover_alt: "Music video Không Có Phép Màu"
video:
  name: "Không Có Phép Màu – buivandat.com"
  url: /assets/media/khong-co-phep-mau/khong-co-phep-mau.mp4
  thumbnail: /assets/media/khong-co-phep-mau/poster.jpg
  duration: PT2M2S
---

Câu mình hay nói nhất khi có người hỏi về MMO là: **kiếm tiền online không có phép màu**. Lần này mình thử nói câu đó theo cách khác: bằng một bài hát. Bài hát và video đều được tạo **hoàn toàn bằng code**, không dùng phần mềm dựng nhạc hay dựng phim.

<figure>
  <video controls playsinline preload="metadata" poster="/assets/media/khong-co-phep-mau/poster.jpg" width="1920" height="1080">
    <source src="/assets/media/khong-co-phep-mau/khong-co-phep-mau.mp4" type="video/mp4">
  </video>
  <figcaption>Không Có Phép Màu · giọng nam · 2:02 · 100 BPM · Fa thăng thứ. <a href="/nhac/khong-co-phep-mau/">Xem bản chạy trực tiếp trên trình duyệt</a> hoặc <a href="/assets/media/khong-co-phep-mau/song.mp3" download>tải MP3</a>.</figcaption>
</figure>

## Lời bài hát

<div class="lyrics" markdown="1">
**Verse 1**
Đêm khuya màn hình vẫn sáng
Từng dòng log chạy không ngơi
Người ta hứa giàu sau một đêm
Còn mình tin vào con số thôi

**Pre-chorus**
Không lối tắt, chẳng ai cho không
Chỉ có bước chân mình đi

**Điệp khúc**
Không có phép màu
Chỉ có kỷ luật mỗi ngày
Công cụ trong tay
Thông tin đúng dẫn đường
Không có phép màu
Đừng tin lời hứa trên mây
Bùi Văn Đạt chấm com
Ghi lại từng bước ta đi

**Verse 2**
Mở tab mới, kết nối máy xa
Kéo file lên, nhấp ngụm cà phê
Thắng thua ghi hết vào sổ
Sai một lần, nhớ cả năm

**Pre-chorus**
Ai cũng muốn đi thật nhanh
Mình chọn đi chậm mà chắc

**Điệp khúc** (lặp lại)

**Outro**
Không có phép màu
Chỉ có mình và ngày mai

</div>

## Bài hát được làm như thế nào?

### Giai điệu sinh ra từ chính lời hát

Tiếng Việt có thanh điệu, nên giai điệu phải "nói" được lời thì nghe mới xuôi tai. Chương trình soạn nhạc đọc dấu của từng chữ rồi chọn nốt:

- Chữ mang dấu **sắc, ngã** thì nốt đi **lên**.
- Chữ mang dấu **huyền, nặng** thì nốt đi **xuống**, dấu **hỏi** xuống nhẹ.
- Chữ **không dấu** thì giữ gần nốt cũ.

Sau đó mỗi nốt được bám vào âm giai và hợp âm của từng ô nhịp (vòng hợp âm F#m – D – A – E). Cả bài được hạ xuống Fa thăng thứ để vừa quãng giọng nam, từ Si2 đến Fa#4. Bước nhảy giữa hai chữ không vượt quá một quãng 4 cho dễ hát. Câu hook "Không có phép màu" lần nào cũng dùng đúng một giai điệu để dễ nhớ.

### Phối khí

Trống, bass, pad, arpeggio và cây synth hát giai điệu đều được tổng hợp từ sóng âm cơ bản (sin, răng cưa, vuông, nhiễu) bằng Python. Có thêm reverb, delay và "sidechain" cho pad nhún theo tiếng trống.

### Giọng hát: từ giọng đọc thành giọng hát

Giọng nam trong bài **không phải người thật hát**. Nó được làm theo hai bước:

1. **Đọc:** một giọng đọc tiếng Việt tổng hợp ([Piper TTS](https://github.com/rhasspy/piper), giọng nam trong bộ dữ liệu VIVOS) đọc **liền cả câu**, chậm rãi, để giữ phần nối âm tự nhiên giữa các chữ. Ranh giới từng chữ được dò tự động bằng cách so khớp với bản đọc từng chữ riêng lẻ (thuật toán DTW).
2. **Hát:** bộ phân tích giọng [WORLD](https://github.com/mmorise/World) tách câu thành cao độ, âm sắc và hơi, rồi dựng lại cả câu thành câu hát:
   - chọn đoạn nguyên âm trong nhất của mỗi chữ để ngân dài, phụ âm đầu vào trước phách một chút như ca sĩ thật;
   - lướt vào nốt đầu câu, luyến có đà (vượt nhẹ rồi về), rung không đều và chỉ ở nốt dài, buông giọng cuối câu;
   - luyến láy nhẹ theo dấu: chữ dấu huyền, nặng hơi rơi ở cuối nốt, chữ dấu sắc, ngã hơi hất lên;
   - nhấn nhá âm lượng theo câu, nốt cao và nốt dài to hơn, có tiếng lấy hơi trước mỗi câu;
   - tạo thêm dải âm cao cho giọng sáng hơn, rồi nén và nhân đôi giọng như khi thu trong phòng thu.

Kết quả hát đúng nốt (lệch trung bình khoảng 4 cent) và tự nhiên hơn bản đầu, nhưng vẫn là giọng máy, chưa có cảm xúc như người thật. Nếu bạn hát được, cứ lấy lời và giai điệu hát lại rồi gửi mình tại [contact@buivandat.com](mailto:contact@buivandat.com). Mình rất muốn nghe!

### Video: mỗi khung hình là một hàm của thời gian

Video không được dựng bằng phần mềm dựng phim. Mỗi khung hình được **vẽ bằng code** dựa trên đúng một con số: thời điểm hiện tại của bài hát. Vì vậy:

- **Chữ hiện đúng từng từ** theo nốt nhạc, kiểu karaoke, vì thời gian của từng chữ được lấy thẳng từ bản soạn nhạc.
- Chữ, biểu đồ và đường kẻ **nảy theo tiếng trống**. Cảnh chuyển ngay đầu ô nhịp.
- **Bản chạy trên trình duyệt và bản MP4 giống hệt nhau.** Bản MP4 được xuất bằng Chrome chạy ngầm và ffmpeg, ở độ phân giải 1080p, 30 khung hình/giây.

Mỗi đoạn nhạc có một cảnh riêng, lấy hình ảnh từ chính công việc hằng ngày:

- **Verse 1:** màn hình đêm khuya, bên trái là file log chạy không ngừng.
- **Pre-chorus:** thanh tiến độ nhích từng phách, vì "không có lối tắt".
- **Điệp khúc:** nền trắng, chữ đập theo nhịp và một biểu đồ đi lên đều đặn (có lúc hụt nhẹ, vì thật thì phải có lúc hụt).
- **Verse 2:** màn hình chia khung giống [Termidat](/blog/termidat-terminal-ssh-sftp-mien-phi/), bên trái là file đang tải lên server, bên phải là sổ ghi thắng thua.

Cách làm này mình học từ dự án mã nguồn mở [pdoom-video](https://github.com/mexicat/pdoom-video) (giấy phép MIT). Đó là một music video cũng được vẽ hoàn toàn bằng code, với nguyên tắc "mỗi khung hình là một hàm của thời gian bài hát". Bài hát, lời và toàn bộ hình ảnh của "Không Có Phép Màu" là mới, không dùng lại nhạc hay hình của dự án đó.

Mình làm bài này cùng Claude (một AI) trong một buổi, từ lời, giai điệu, phối khí, giọng hát đến video. Mã nguồn nằm trong [repo của website](https://github.com/datjbl932-web/buivandat/tree/main/music/khong-co-phep-mau), ai tò mò có thể xem và tự chạy lại.

### Ghi nguồn & giấy phép

- Giọng đọc gốc: mô hình Piper `vi-vivos-x-low`, huấn luyện trên bộ dữ liệu [VIVOS](https://ailab.hcmus.edu.vn/vivos/) của AILAB, ĐH Khoa học Tự nhiên TP.HCM, giấy phép [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.vi).
- Vì phần giọng hát được tạo từ dữ liệu đó, **bài hát "Không Có Phép Màu" cũng được chia sẻ theo CC BY-NC-SA 4.0**. Bạn được nghe, chia sẻ và làm lại, miễn là ghi nguồn buivandat.com, không dùng cho mục đích thương mại và giữ cùng giấy phép.
- Bộ phân tích giọng WORLD (giấy phép BSD), cách làm video lấy cảm hứng từ pdoom-video (MIT).

---

Chúc bạn một ngày làm việc có kỷ luật. Nếu thấy bài hát vui, chia sẻ cho một người bạn đang "tìm phép màu" nhé!
