---
target: giao diện hiện tại
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-09-15T16-06-38Z
slug: apps-web-src-components-workspace-shell-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/evidence_review)

# Đánh giá giao diện Wind EDU

## Nhận định

Giao diện có bản sắc và nền tảng tốt, nhưng trải nghiệm thao tác chưa tương xứng. Giữ phong cách sổ giáo vụ đương đại; ưu tiên bảo vệ bản nháp, điều hướng bàn phím và hướng dẫn đúng vai trò trước khi trang trí thêm.

Đã kiểm tra giao diện thật với API mô phỏng, desktop 1440×900 và mobile 390×844: đề thi/editor, học vụ, settings, operations, hồ sơ lớp. Chưa kiểm chứng lưu/nộp thật, dữ liệu lớn, toàn bộ dark mode/English, screen reader hoặc hiệu suất production.

## Điểm sức khỏe thiết kế

Điểm đánh giá chuyên gia tạm thời, không phải kết quả nghiên cứu người dùng.

| Tiêu chí | Điểm /4 | Nhận xét |
|---|---:|---|
| Trạng thái hệ thống | 2 | Có loading/badge; lịch và thông báo rỗng thiếu giải thích |
| Ngôn ngữ người dùng | 2 | Còn Actor, Target, seed, fingerprint trong luồng tiếng Việt |
| Kiểm soát và thoát | 2 | Thoát modal được nhưng mất bản nháp; drawer sai focus |
| Nhất quán | 3 | Hệ hình ảnh tốt; hành vi drawer khác modal |
| Ngăn lỗi | 2 | Có ràng buộc form; thiếu bảo vệ dữ liệu chưa lưu |
| Nhận biết thay vì nhớ | 2 | Navigation có nhãn; hướng dẫn sai vai trò |
| Hiệu quả thao tác | 2 | Có tìm kiếm/tab; mobile còn nhiều cuộn |
| Thẩm mỹ và tối giản | 3 | Sổ phẳng dễ quét; Operations dàn quá nhiều việc |
| Khôi phục lỗi | 2 | Có thông báo/retry trong source; chưa thử lỗi API thật |
| Trợ giúp | 1 | Có hướng dẫn nhưng learner gặp chỉ dẫn không thể làm |
| Tổng | 21/40 | Chấp nhận được, cần cải thiện UX đáng kể |

## Đặc trưng và điểm mạnh

Nền giấy ấm, navy, đỏ gạch và Be Vietnam Pro tạo bản sắc sổ giáo vụ, không phải dashboard chung chung. Settings chia phạm vi và trạng thái rõ. Hồ sơ lớp giữ được ngữ cảnh nghiệp vụ. Modal editor đã có focus trap, Escape và trả focus đúng — nên tái sử dụng cho drawer.

## Vấn đề ưu tiên

1. **P1 — Đóng editor mất bản nháp.** Nhập tên đề, Escape, mở lại: tên trở thành rỗng, không cảnh báo. Giữ draft và hỏi xác nhận khi bỏ thay đổi. Source: `apps/web/src/features/exams/use-exams-model.tsx:434`, `exam-editor-dialog.tsx:81`. Lệnh phù hợp: `$impeccable harden`.
2. **P1 — Drawer mobile không giữ focus.** Mở menu rồi Tab đưa focus đến nút giao diện tối bị overlay che. Hai tác nhân tái hiện độc lập. Dùng dialog primitive, focus trap, inert nền, trả focus khi đóng. Source: `apps/web/src/components/workspace-shell.tsx:302,435`. Lệnh: `$impeccable harden`.
3. **P2 — Chỉ dẫn sai quyền learner.** Đề thi rỗng yêu cầu “Tạo bản ghi đầu tiên” dù không có nút tạo; hồ sơ lớp hướng dẫn đóng lớp. Viết empty-state/checklist theo vai trò và trạng thái, kèm hành động khả dụng. Source: `apps/web/src/components/section-state.tsx:6`, `features/class-detail/class-detail-screen.tsx:264`. Lệnh: `$impeccable clarify`.
4. **P2 — Operations quá tải.** Sáu nhóm nghiệp vụ cùng mở, audit có bảy điều khiển, màn mobile dữ liệu thưa vẫn dài 2829px. Chia phạm vi như Settings, ưu tiên việc cần xử lý, thu gọn filter và Việt hóa thuật ngữ. Source: `apps/web/src/features/operations/operations-screen.tsx:96,117`. Lệnh: `$impeccable distill`, `$impeccable clarify`.
5. **P2 — Chữ phụ Operations thiếu tương phản.** Ba nút văn bản được detector và axe xác nhận: “Phiên bản 1” đạt 3.15:1; metadata retention và mô tả cảnh báo đạt 4.42:1, dưới ngưỡng 4.5:1 áp dụng. Tăng độ đậm màu token chữ phụ, kiểm tra lại trên nền thật. Source: `apps/web/src/features/operations/operations-screen.tsx:436,613,684`. Lệnh: `$impeccable polish`.

Không xác nhận P0 trong phạm vi thử nghiệm.

## Tải nhận thức và hành trình cảm xúc

Vào ứng dụng có cảm giác bình tĩnh, đáng tin. Settings hỗ trợ chọn từng việc; Operations buộc xử lý nhiều quyết định cùng lúc. Learner gặp hướng dẫn sai quyền, còn giảng viên có thể kết thúc bằng mất nháp. Bảo vệ nỗ lực người dùng quan trọng hơn thêm animation.

## Ba nhóm người dùng

- Sam, người dùng bàn phím: drawer hiển thị nhưng focus ở phía sau.
- Jordan, learner mới: tìm nút tạo đề hoặc đóng lớp không tồn tại.
- Casey, giảng viên mobile: form dài và thoát nhanh làm mất nội dung.

## Quan sát nhỏ

Hồ sơ lớp mobile khoảng 1900px ngay cả với dữ liệu thưa: đưa việc gần hạn/lối vào bài tập lên trước metadata. Sidebar có hai nhãn 10px. Nút bỏ chọn lớp 32×32 nên tăng vùng chạm; đây không tự động là lỗi WCAG. Bảng học vụ cuộn ngang trong container, không phải tràn toàn trang. Lịch/thông báo rỗng cần câu xác nhận.

## Detector và đối chiếu

CLI quét 88 file: 0 findings, JSON `[]`. Runtime trên 4 route: 16 lần phát hiện, gồm 8 chữ nhỏ (hai nhãn shell lặp), 4 cream-palette, 3 low-contrast, 1 nested-cards. Loại cream-palette vì đúng DESIGN.md; không nâng nested-cards thành lỗi chỉ từ heuristic. Axe: Operations có 1 rule/3 node; ba route khác và editor không có violation trong trạng thái đã thử. Đây không phải chứng nhận toàn bộ accessibility. Không thấy document overflow ở tám cấu hình route/viewport.

## Câu hỏi định hướng

1. Lượt sửa đầu ưu tiên: A. Bản nháp + focus drawer; B. Hướng dẫn theo vai trò; C. Giảm tải Operations/mobile?
2. Hồ sơ lớp mobile nên ưu tiên: A. Việc gần hạn; B. Lối vào bài tập/học liệu/đề; C. Giữ tổng quan và chỉ thu gọn metadata?
