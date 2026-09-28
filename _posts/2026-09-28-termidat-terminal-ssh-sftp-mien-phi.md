---
title: "Termidat: terminal miễn phí có sẵn SSH và SFTP, mình tự làm"
date: 2026-09-28 11:00:00 +0700
category: phan-mem
description: "Quản lý nhiều VPS, SSH, tải file qua SFTP và chia nhiều khung terminal trong một ứng dụng duy nhất. Miễn phí, mã nguồn mở, chạy trên Windows, macOS và Linux."
image: /assets/img/posts/termidat-cover.jpg
image_alt: "Biểu tượng và tên phần mềm Termidat"
---

Làm MMO lâu, sớm muộn bạn cũng phải thuê **VPS** để chạy tool, bot hay những tác vụ cần bật 24/7. Lúc đó, mỗi ngày sẽ lặp đi lặp lại mấy việc: mở terminal, SSH vào server, tải file lên, xem log, rồi lại chuyển sang server khác.

Mình từng dùng mỗi việc một phần mềm riêng, và thấy khá rối. Vì vậy mình tự viết **Termidat**: một ứng dụng terminal gom cả SSH lẫn SFTP vào một chỗ, **miễn phí** và **mã nguồn mở**.

## Termidat là gì?

Termidat là phần mềm terminal chạy trên **Windows, macOS và Linux**, lấy cảm hứng từ Terminus/Tabby. Ngoài việc mở các shell trên máy (PowerShell, CMD, Git Bash, WSL, zsh, bash…), nó có sẵn:

- **SSH client** để kết nối và quản lý nhiều server.
- **SFTP** để duyệt, tải lên, tải xuống file ngay bên cạnh cửa sổ SSH.

Bạn không cần cài thêm PuTTY hay WinSCP.

## Tính năng chính

### Tab và chia khung

- Mở **nhiều tab**, kéo thả để sắp xếp, bấm chuột giữa để đóng. Tab đang chạy nền có chấm báo khi có dữ liệu mới.
- **Chia khung dọc hoặc ngang** không giới hạn, kéo đường chia để đổi kích thước. Rất tiện khi vừa chạy lệnh vừa theo dõi log.
- **Tìm kiếm** trong terminal, có tuỳ chọn phân biệt hoa/thường.
- Gõ `exit` là đóng khung. Nếu tiến trình lỗi hoặc SSH rớt mạng, chỉ cần nhấn **Enter** để chạy lại hoặc kết nối lại.

### SSH: quản lý nhiều server

- Lưu **hồ sơ kết nối theo nhóm**, ví dụ nhóm "VPS tool", nhóm "VPS web".
- **Nhập nhanh** các server có sẵn trong file `~/.ssh/config`.
- Đăng nhập bằng **mật khẩu**, **private key** (kể cả key có passphrase), **SSH agent** hoặc **Pageant** (PuTTY).
- Mật khẩu được **mã hoá bằng kho khoá của hệ điều hành** (Windows DPAPI, macOS Keychain, libsecret trên Linux), không lưu dạng chữ thường.
- **Kiểm tra vân tay khoá của server** và cảnh báo khi khoá thay đổi, giúp phát hiện tấn công giả mạo server (man-in-the-middle).

### SFTP: tải file ngay cạnh terminal

Trong tab SSH, bấm `Ctrl+Shift+O` hoặc nút **SFTP** để mở bảng duyệt file trên server:

- **Tải lên / tải xuống** cả file lẫn thư mục, có thanh tiến độ, tốc độ và nút huỷ.
- **Kéo thả** file từ Explorer/Finder vào bảng SFTP, hoặc thả thẳng vào terminal SSH, để tải lên.
- Tạo thư mục, đổi tên (`F2`), xoá (`Delete`), sao chép đường dẫn, hiện/ẩn file ẩn.
- Tải xuống **không ghi đè** file đã có: tự đặt tên kiểu `a (1).txt`.

### Dành riêng cho Windows

- **Thanh tab nằm trên thanh tiêu đề**, giống Windows Terminal.
- Tự nhận **PowerShell 7, Windows PowerShell, CMD, Git Bash, MSYS2, Cygwin** và **từng bản WSL** (Ubuntu, Debian…).
- **Ctrl+C / Ctrl+V như Windows Terminal:** đang bôi đen thì Ctrl+C là sao chép, không thì là lệnh ngắt như bình thường.
- Mục **"Mở Termidat tại đây"** trong menu chuột phải của Explorer (khi dùng bản cài đặt).
- Kéo thả file vào terminal sẽ dán đường dẫn, tự bọc ngoặc kép khi có dấu cách.

### Giao diện tuỳ chỉnh

Có sẵn **6 theme**: Termidat Dark, Dracula, One Dark, Nord, Solarized Dark, GitHub Light. Bạn chỉnh được font, cỡ chữ, giãn dòng, kiểu con trỏ, số dòng lưu lại, tự sao chép khi bôi đen và hành vi chuột phải.

## Người làm MMO dùng Termidat vào việc gì?

Một vài cách mình dùng hằng ngày:

1. **Quản lý nhiều VPS theo nhóm**, bấm một lần là vào đúng server cần làm việc.
2. **Tải tool, file cấu hình lên VPS** bằng kéo thả qua SFTP, không cần mở thêm phần mềm khác.
3. **Chia khung** để một bên chạy tool, một bên xem log, một bên theo dõi tài nguyên máy.
4. Khi mạng chập chờn làm rớt SSH, chỉ cần **nhấn Enter** để kết nối lại, không phải gõ lại từ đầu.

## Tải về

Phiên bản hiện tại: **v0.1.0**. Link tải trực tiếp từ GitHub, không cần đăng nhập.

| Hệ điều hành | File | Dung lượng |
|---|---|---:|
| Windows (bản cài đặt, khuyên dùng) | [Termidat-0.1.0-win-x64-setup.exe](https://github.com/datjbl932-web/Termidat/releases/download/v0.1.0/Termidat-0.1.0-win-x64-setup.exe) | ~106 MB |
| Windows (portable, không cần cài) | [Termidat-0.1.0-win-x64-portable.exe](https://github.com/datjbl932-web/Termidat/releases/download/v0.1.0/Termidat-0.1.0-win-x64-portable.exe) | ~106 MB |
| macOS (chip Apple M) | [Termidat-0.1.0-mac-arm64.dmg](https://github.com/datjbl932-web/Termidat/releases/download/v0.1.0/Termidat-0.1.0-mac-arm64.dmg) | ~109 MB |
| macOS (chip Intel) | [Termidat-0.1.0-mac-x64.dmg](https://github.com/datjbl932-web/Termidat/releases/download/v0.1.0/Termidat-0.1.0-mac-x64.dmg) | ~111 MB |
| Linux (AppImage) | [Termidat-0.1.0-linux-x86_64.AppImage](https://github.com/datjbl932-web/Termidat/releases/download/v0.1.0/Termidat-0.1.0-linux-x86_64.AppImage) | ~100 MB |
| Linux (Debian/Ubuntu) | [Termidat-0.1.0-linux-amd64.deb](https://github.com/datjbl932-web/Termidat/releases/download/v0.1.0/Termidat-0.1.0-linux-amd64.deb) | ~99 MB |

Các phiên bản mới sẽ có ở trang [Releases của Termidat](https://github.com/datjbl932-web/Termidat/releases/latest).

## Cài đặt lần đầu

Ứng dụng **chưa được ký số**, nên lần đầu mở hệ điều hành sẽ hiện cảnh báo. Đây là chuyện bình thường với phần mềm mã nguồn mở nhỏ:

- **Windows:** trong hộp thoại SmartScreen, bấm **More info → Run anyway**.
- **macOS:** chuột phải vào ứng dụng → **Open**.

> Chỉ tải Termidat từ link trong bài này hoặc trang GitHub chính thức. Đừng tải các bản do người khác đăng lại, vì bạn không biết họ đã sửa gì bên trong.

## Phím tắt hay dùng

Trên macOS, thay `Ctrl+Shift` bằng `⌘`.

| Phím | Chức năng |
|---|---|
| `Ctrl+Shift+T` | Mở tab mới |
| `Ctrl+Shift+W` | Đóng khung / tab hiện tại |
| `Ctrl+Shift+D` | Chia khung dọc |
| `Ctrl+Shift+E` | Chia khung ngang |
| `Ctrl+Shift+S` | Mở quản lý SSH |
| `Ctrl+Shift+O` | Bật/tắt bảng SFTP |
| `Ctrl+Shift+F` | Tìm kiếm |
| `Alt+1` … `Alt+9` | Chuyển tới tab thứ N |
| `Ctrl+,` | Mở cài đặt |

## Mã nguồn mở và an toàn

Termidat phát hành theo giấy phép **MIT**, toàn bộ mã nguồn công khai tại [github.com/datjbl932-web/Termidat](https://github.com/datjbl932-web/Termidat). Ai cũng có thể xem ứng dụng làm gì với dữ liệu của mình.

Hồ sơ SSH và cấu hình chỉ lưu **trên máy của bạn**:

- Windows: `%APPDATA%\Termidat`
- macOS: `~/Library/Application Support/Termidat`
- Linux: `~/.config/Termidat`

Một lời khuyên chung khi làm việc với VPS: nên **đăng nhập bằng SSH key thay cho mật khẩu**, và đừng bỏ qua cảnh báo khi vân tay khoá của server bỗng dưng thay đổi.

---

Termidat mới ở bản đầu tiên nên chắc chắn còn nhiều chỗ cần cải thiện. Nếu gặp lỗi hoặc muốn có thêm tính năng, bạn gửi mail cho mình tại [contact@buivandat.com](mailto:contact@buivandat.com) hoặc mở issue trên [GitHub](https://github.com/datjbl932-web/Termidat/issues). Mình đọc hết.
