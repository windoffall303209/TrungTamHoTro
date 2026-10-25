# Wind EDU — Sky Blue Minimalist & Modern Command Bar Architecture

## 1. Triết lý thiết kế & Bố cục mới (New Layout Architecture)

Hệ thống giao diện mới của Wind EDU đập bỏ hoàn toàn thanh sidebar dọc 256px truyền thống gây chật chội không gian, chuyển sang **Kiến trúc Top Command Center & Contextual Sub-Nav Strip** hiện đại:

- **Bố cục Không gian Mở (Full-Width Canvas):** Giải phóng toàn bộ 100% chiều ngang màn hình cho bảng dữ liệu, học liệu, phòng học online và đề thi.
- **Top Command Center (Tầng 1):** Thanh điều hướng chính dạng kính mờ (glassmorphism) cố định trên đỉnh, phân tách rõ 4 cụm chuyên mục:
  - 🎓 **Học tập & Giảng dạy** (`/dashboard`, `/courses`, `/academic`, `/live-classes`)
  - 📝 **Khảo thí & Học liệu** (`/exams`, `/questions`, `/materials`)
  - 💬 **Cộng đồng & Hỗ trợ** (`/forum`, `/messages`, `/support`, `/learning-history`)
  - ⚙️ **Quản trị & Vận hành** (`/reports`, `/class-operations`, `/attendance`, `/admin/users`, v.v.)
- **Contextual Sub-Nav Strip (Tầng 2):** Dải danh mục phụ trực quan tự động hiển thị các trang nghiệp vụ thuộc chuyên mục đang chọn, hỗ trợ chuyển trang tức thời bằng 1 chạm.
- **Mobile Adaptive Drawer:** Trên màn hình di động (<1024px), thanh điều hướng thu gọn vào menu trượt tiện lợi.

---

## 2. Hệ màu Sky Blue (Xanh da trời hiện đại)

### A. Light Theme (Giao diện sáng tinh khôi)
- **Primary Accent:** `#0284c7` (Sky 600) — Màu xanh da trời biển sâu, biểu tượng của sự rộng mở, tin cậy và sáng tạo.
- **Primary Hover & Focus:** `#0369a1` (Sky 700), `rgba(2, 132, 199, 0.18)` focus ring.
- **Canvas (Nền chính):** `#f8fafc` (Slate 50) — Dịu mắt, tối giản.
- **Surface (Bề mặt thẻ/hộp thoại):** `#ffffff` (Pure White) — Nổi bật tự nhiên với viền hairline `#e2e8f0`.
- **Text:** `#0f172a` (Slate 900) cho tiêu đề và nội dung chính, `#475569` (Slate 600) cho văn bản phụ.

### B. Dark Theme (Cosmic Azure Obsidian)
- **Primary Accent:** `#38bdf8` (Sky 400) — Xanh da trời dạ quang phát sáng nhẹ trên nền tối.
- **Canvas (Không gian sâu):** `#070b14` (Deep Space Obsidian).
- **Surface Level 1:** `#0f1a2e` (Thẻ và bảng biểu).
- **Surface Level 2:** `#162847` (Hộp thoại, Menu popover).
- **Borders:** `#1a2942` — Đường viền mảnh định hình khối sắc nét.
- **Text:** `#f8fafc` (Slate 50) sắc nét, không lóa mắt.

---

## 3. Thành phần Giao diện Chuẩn mực (UI Primitives)

- **Button:** Bấm nảy nhẹ, bo góc vừa phải (`rounded-lg`), biến thể `primary` màu Sky 600, `secondary` viền mảnh, `danger` đỏ hồng, `ghost`.
- **Field & Input:** Nền trắng/tối với viền mảnh và focus ring `ring-2 ring-sky-500/15`.
- **Status Badges:** Dạng pill mềm mại bo tròn hoàn toàn với chấm phát tín hiệu (`size-1.5 rounded-full`).
- **Dashboard:** Bố cục Command Center với banner chào mừng gradient Sky Blue, 3 chỉ số KPI tối giản và lưới mô-đun chức năng.
