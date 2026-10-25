---
name: Wind EDU
description: Nền tảng Giảng dạy & Học tập Số — Theme tươi mát, trực quan và tối ưu thao tác.
colors:
  canvas: "#f8fafc"
  canvas-deep: "#f1f5f9"
  surface: "#ffffff"
  ink: "#0f172a"
  ink-soft: "#334155"
  ink-muted: "#64748b"
  rule: "#e2e8f0"
  rule-strong: "#cbd5e1"
  emerald: "#059669"
  emerald-light: "#10b981"
  teal: "#0d9488"
  cyan: "#0284c7"
  amber: "#f59e0b"
  rose: "#e11d48"
  night-canvas: "#0b1322"
  night-surface: "#152238"
  night-ink: "#f8fafc"
  night-emerald: "#10b981"
typography:
  display:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontWeight: 800
    lineHeight: 1.2
  body:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "12px"
  card: "16px"
  dialog: "20px"
---

# Design System: Wind EDU (Modern EdTech)

## 1. Triết lý Thiết kế: "Tươi Mát, Trực Quan, Tối Ưu Tác Vụ"

Wind EDU được tái thiết kế theo tiêu chuẩn nền tảng giáo dục số đương đại:
- **Tươi mới & Khơi gợi cảm hứng**: Bảng màu chủ đạo Ngọc Lục Bảo (Emerald) phối hợp cùng Xanh Đại Dương (Oceanic Teal & Sky Cyan) mang lại cảm giác nhẹ nhàng, tràn đầy năng lượng học tập và giảng dạy.
- **Tối ưu thao tác người dùng (Workflow-First)**: Loại bỏ các rào cản thao tác (action barriers). Mọi thông tin quan trọng đều có thể tương tác trực tiếp: cân bằng điểm tự động, gợi ý nhanh lý do chấm thi, thẻ trạng thái có đèn tín hiệu, tìm kiếm tài liệu nhạy bén.
- **Phân cấp thị giác rõ ràng**: Canvas sáng sạch (`#f8fafc`) kết hợp thẻ bề mặt phẳng có bóng đổ tinh tế (`rounded-2xl`, `shadow-xs`), viền chuẩn mực (`border-slate-200`), phông chữ sắc nét `Be Vietnam Pro`.

## 2. Bảng Màu Ngữ Nghĩa (Semantic Palette)

- **Primary / Brand Action**: Emerald `#059669` (Dark `#10b981`).
- **Surface**: White `#ffffff` (Dark `#152238`).
- **Canvas Backdrop**: Slate-50 `#f8fafc` (Dark `#0b1322`).
- **Text & Contrast**: Slate-900 `#0f172a` (Chính), Slate-600 `#334155` (Phụ), Slate-400 `#94a3b8` (Ghi chú).
- **Trạng thái (Status Dots & Badges)**:
  - Thành công / Hoạt động / Đã công bố: Emerald `#10b981` (Nền `#ecfdf5`).
  - Chờ duyệt / Đang xử lý: Amber `#f59e0b` (Nền `#fffbeb`).
  - Lỗi / Từ chối / Khóa: Rose `#e11d48` (Nền `#fff1f2`).
  - Bản nháp / Trung gian: Slate `#64748b` (Nền `#f1f5f9`).

## 3. Thành Phần Giao Diện (Core Components)

1. **Button**:
   - `primary`: Nền xanh ngọc emerald rực rỡ, hover nâng nhẹ, hiệu ứng active scale 0.98.
   - `secondary`: Viền slate crisp, nền trắng, hover chuyển nhẹ sang ánh mint.
   - `danger`: Sắc đỏ hồng rose tươi, cảnh báo rõ ràng.
   - `ghost`: Nút phẳng không viền, làm nổi bật nội dung bảng và danh sách.

2. **Workspace Shell**:
   - Sidebar đêm đại dương sâu (`#091b29`), thanh điều hướng nhóm theo 4 phân hệ rõ ràng (Giảng dạy, Khảo thí, Trao đổi, Quản trị).
   - Thanh Header kính mờ (`backdrop-blur-md bg-white/85`), hiển thị huy hiệu vai trò có đèn tín hiệu pulsing, chuông thông báo trực quan và chuyển vai trò tiện lợi.

3. **StatusBadge**:
   - Bo tròn dạng viên thuốc (`rounded-full`), tích hợp chấm tín hiệu trạng thái (`●`), viền và nền pastel dịu mắt.

4. **Trang Dashboard & Danh sách Đề thi**:
   - Banner chào đón với nền gradient đa sắc tinh tế.
   - Các thẻ chỉ số hoạt động (KPI Cards) có số liệu nổi bật và hiệu ứng hover tinh tế.
   - Lưới phân hệ dạng Card tương tác, biểu tượng bo góc hiện đại.
