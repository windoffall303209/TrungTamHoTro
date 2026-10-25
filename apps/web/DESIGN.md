# Wind EDU — Clean Slate Minimalist Design System

## 1. Triết lý thiết kế (Design Philosophy)

Hệ thống giao diện mới của Wind EDU được xây dựng dựa trên 5 nguyên tắc nền tảng:

- **Minimalism (Tối giản chuẩn mực):** Loại bỏ mọi thành phần trang trí thừa thãi, hoa văn rườm rà. Tập trung tối đa vào nội dung và tác vụ học tập/giảng dạy.
- **Clean UI (Giao diện sạch sẽ):** Bố cục thoáng đãng, tỷ lệ khoảng cách (spacing) đồng nhất dựa trên bội số của 4px (padding 8px, 12px, 16px, 20px, 24px). Đường viền hairline tinh tế (`1px solid`).
- **Modern UX (Trải nghiệm hiện đại):** Thao tác nhanh gọn, giảm thiểu số bước tương tác, phản hồi trạng thái tức thời (Hover, Focus, Active, Disabled, Loading).
- **Responsive (Đa nền tảng):** Tương thích hoàn hảo trên Desktop (1280px+), Tablet (768px-1024px) và Mobile (<768px) với Mobile Drawer mượt mà.
- **Independent Themes (Hai hệ thống Theme độc lập):** Light Theme và Dark Theme được thiết kế và tính toán quang học riêng biệt, không phải là phép đảo màu máy móc.

---

## 2. Hệ màu & Design Tokens

### A. Light Theme (Giao diện sáng)
- **Canvas (Nền chính):** `#f8fafc` (Slate 50) — Nền dịu mắt, sạch sẽ.
- **Surface (Thẻ, Bảng, Hộp thoại):** `#ffffff` (Pure White) — Nổi bật nhẹ trên nền canvas.
- **Hairline Borders:** `#e2e8f0` (Slate 200) — Viền 1px thanh lịch.
- **Typography:**
  - Tiêu đề & Văn bản chính: `#0f172a` (Slate 900) — Tương phản cao, dễ đọc.
  - Văn bản phụ / Mô tả: `#475569` (Slate 600).
  - Nhãn mờ / Placeholder: `#94a3b8` (Slate 400).
- **Brand Primary Accent:** `#059669` (Emerald 600) — Sắc xanh ngọc lục bảo tươi mát, tượng trưng cho tri thức và tăng trưởng.
- **Đổ bóng (Shadows):** Cực kỳ nhẹ nhàng (`0 1px 3px rgba(15, 23, 42, 0.04)`), không tạo bóng đổ tối đậm.

### B. Dark Theme (Giao diện tối chuyên sâu)
- **Canvas (Không gian sâu):** `#080c14` (Deep Space Obsidian) — Không bị ám xám đục.
- **Surface Level 1 (Thẻ, Sidebar):** `#101927` — Phân lớp chiều sâu quang học.
- **Surface Level 2 (Modal, Popover):** `#162438` — Nổi bật trên Level 1.
- **Hairline Borders:** `#1e293b` (Slate 800) — Đường viền mảnh định hình khối rõ nét.
- **Typography:**
  - Tiêu đề & Văn bản chính: `#f8fafc` (Slate 50) — Rõ nét, không gây chói mắt.
  - Văn bản phụ / Mô tả: `#94a3b8` (Slate 400).
  - Nhãn mờ / Placeholder: `#64748b` (Slate 500).
- **Brand Primary Accent:** `#10b981` (Emerald 500) — Phát sáng nhẹ nhàng trên nền tối.
- **Đổ bóng (Shadows):** Kết hợp glow viền tinh tế và shadow mờ sâu.

---

## 3. Kiến trúc Component cốt lõi

1. **Button (`<Button />`):**
   - Các biến thể: `primary` (Emerald), `secondary` (viền mảnh tinh gọn), `danger` (Rose), `ghost`.
   - Trạng thái: Hover nâng nhẹ/đổi sắc thái, Active scale `0.98`, Loading với spinner xoay đều, Disabled mờ 45% không click được.

2. **Form Controls (`inputClass`, `<Field />`):**
   - Viền `border-slate-200 dark:border-slate-800`.
   - Bo góc vừa phải (`rounded-lg` / `8px`).
   - Focus ring mảnh: `ring-2 ring-emerald-500/15` sạch sẽ, không che khuất nhãn.

3. **Status Badges (`<StatusBadge />`):**
   - Dạng pill mềm mại bo tròn hoàn toàn (`rounded-full`).
   - Chấm tròn chỉ thị màu phát tín hiệu trực quan (`size-1.5 rounded-full`).
   - Phối màu ngữ nghĩa: Hoạt động (Emerald), Cảnh báo/Chờ duyệt (Amber), Từ chối/Lỗi (Rose), Trung tính (Slate).

4. **Sidebar & Header:**
   - Sidebar thích ứng hoàn toàn: Nền trắng trong Light mode, Nền obsidian trong Dark mode.
   - Header dạng kính mờ (glassmorphism) với `backdrop-blur-md` tinh tế.
   - Nút `ThemeToggle` lưu song song cả `localStorage` và `cookie` để loại bỏ 100% tình trạng nhấp nháy giao diện khi tải lại trang.
