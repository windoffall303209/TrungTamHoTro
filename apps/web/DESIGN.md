---
name: Wind EDU
description: Hệ thống vận hành giảng dạy chung theo ngôn ngữ sổ giáo vụ đương đại.
colors:
  paper: "#f7f4ed"
  paper-deep: "#eee8dc"
  surface: "#fffdfa"
  ink: "#102a43"
  ink-soft: "#516274"
  rule: "#d5dfe2"
  rule-strong: "#a9bac1"
  vermilion: "#c75b39"
  night-canvas: "#0b1620"
  night-surface: "#172b3a"
  night-ink: "#f5efe6"
  night-vermilion: "#e47c59"
typography:
  display:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "8px"
  panel: "12px"
spacing:
  compact: "8px"
  standard: "16px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "10px 16px"
---

# Design System: Wind EDU

## Overview

**Creative North Star: "Sổ giáo vụ đương đại"**

Wind EDU là không gian làm việc chung cho bốn vai trò ngang hàng. Giao diện ưu tiên đọc nhanh, kiểm tra trạng thái và đi vào thao tác tiếp theo; nó giống bàn điều phối có sổ ghi chép rõ ràng hơn là một dashboard đầy thẻ nổi.

Không khí ấm, có chất liệu giấy và mực xanh đen tạo cảm giác tin cậy của nghiệp vụ giáo dục. Màu đỏ gạch chỉ dành cho hành động quan trọng hoặc tín hiệu cần chú ý; phần còn lại dùng đường kẻ, khoảng trắng và kiểu chữ để tổ chức thông tin.

**Key Characteristics:**

- Mật độ vừa phải, theo hàng và cột như trang sổ.
- Một không gian vận hành dùng chung, điều hướng thay đổi theo vai trò chứ không thay đổi bản sắc.
- Tối giản có chủ đích: mặt phẳng, viền mảnh, không tạo cảnh quan thẻ nổi.

## Colors

Nền giấy ấm giữ trải nghiệm bình tĩnh, còn mực xanh đen và đường kẻ xanh xám tạo phân cấp chính xác.

### Primary

- **Mực điều phối:** dùng cho chữ chính, sidebar và nút hành động chính; giữ độ tương phản cao trên nền giấy.
- **Dấu đỏ gạch:** dùng tiết chế cho trạng thái được chọn, hành động cần xác nhận và điểm cần chú ý.

### Neutral

- **Giấy vận hành:** dùng cho canvas nền.
- **Giấy sáng:** dùng cho input, popover và các vùng cần tách nền nhẹ.
- **Đường sổ:** dùng làm ranh giới giữa hàng, vùng và nhóm dữ liệu.

**The One Accent Rule.** Đỏ gạch không được dùng làm nền trang hoặc màu trang trí lặp lại; nó chỉ đánh dấu điều cần người dùng hành động hoặc nhận biết ngay.

### Light & Dark

- **Sáng — Giấy ban ngày:** nền giấy ấm, mặt phẳng ngà và mực xanh đen; phù hợp phòng học, văn phòng và môi trường có ánh sáng mạnh.
- **Tối — Sổ giáo vụ ban đêm:** canvas xanh mực sâu, mặt phẳng xanh than phân tầng, chữ ngà ấm và đỏ gạch sáng hơn; giảm chói khi đọc lâu nhưng vẫn giữ nguyên nhận diện Wind EDU.
- Hai theme dùng chung token theo vai trò (`canvas`, `surface`, `ink`, `rule`, `action`, `semantic`) thay vì đảo màu trực tiếp. Sidebar luôn là vùng mực đậm; surface và trạng thái được phối riêng cho từng theme.
- Lựa chọn được lưu trên thiết bị. Khi chưa có lựa chọn, hệ thống mặc định dùng theme sáng và áp theme trước hydration để không nháy nền sai.

## Typography

**Display Font:** Be Vietnam Pro, Arial, sans-serif.
**Body Font:** Be Vietnam Pro, Arial, sans-serif.

**Character:** Be Vietnam Pro tạo một hệ chữ sans-serif thống nhất cho phần mềm vận hành: tiêu đề đậm, gọn và có độ tương phản bằng kích thước; dữ liệu, nhãn và thao tác vẫn sắc nét khi hiển thị tiếng Việt ở mật độ cao.

### Hierarchy

- **Display:** 700, 1.875–2.125rem, 1.2; dành cho tiêu đề trang và điểm vào công việc.
- **Headline:** 700, 1.25rem, 1.3; dành cho tiêu đề mục và đối tượng nghiệp vụ.
- **Body:** 400–600, 0.875–1rem, 1.5; dành cho mô tả và dữ liệu đọc liên tục.
- **Label:** 700, 0.75rem, giãn chữ nhẹ; dành cho meta và điều hướng phụ, không dùng để tạo “eyebrow” phía trên tiêu đề.

## Layout

Desktop có rail điều hướng cố định bên trái, dải ngữ cảnh ở đầu và canvas nội dung rộng tối đa 80rem. Danh sách nghiệp vụ ưu tiên hàng ngang: nhận diện đối tượng ở trái, số liệu hoặc trạng thái ở giữa, thao tác ở phải.

Trên mobile, rail chuyển thành drawer, phần mô tả đầu trang được tiết chế và thanh trên giữ menu, vai trò và thông báo trong một hàng. Khoảng cách dùng nhịp 8px, 16px, 32px; vùng đọc không bị chia thành nhiều cột thẻ không cần thiết.

## Elevation & Depth

Hệ thống phẳng theo mặc định. Chiều sâu đến từ giấy sáng hơn, viền xanh xám và nền phủ mờ của header; bóng chỉ xuất hiện cho drawer và popover vì chúng vượt lên trên luồng thao tác.

**The Flat-By-Default Rule.** Không thêm shadow để làm mọi container “nổi”; nếu một vùng không có hành vi tương tác hoặc tầng không gian riêng, hãy để nó phẳng và dùng đường sổ để phân chia.

## Shapes

Các control dùng góc mềm 8–12px để dễ chạm nhưng không biến giao diện thành bộ card bo tròn. Danh sách và vùng dữ liệu chính dùng cạnh thẳng với viền trên/dưới; chip nhỏ có bán kính vừa đủ để nhận diện trạng thái.

## Components

### Buttons

- **Shape:** góc mềm (12px), chiều cao tối thiểu rõ ràng cho thao tác chuột và cảm ứng.
- **Primary:** mực điều phối trên giấy sáng; chỉ dùng cho hành động tiếp theo rõ nhất.
- **Secondary / Ghost:** nền giấy hoặc trong suốt, có viền hoặc phản hồi hover nhẹ; dùng cho thao tác phụ trong từng hàng.
- **Focus:** viền đỏ gạch và vòng focus trong suốt đủ nhìn bằng bàn phím.

### Inputs / Fields

- **Style:** giấy sáng, viền đường sổ, góc 12px.
- **Focus:** chuyển viền sang đỏ gạch, không dùng hiệu ứng phát sáng nặng.

### Navigation

- **Style:** rail xanh đen với icon tuyến tính; mục hiện hành là dải giấy sáng, chữ xanh đen và dấu đỏ gạch.
- **Mobile:** rail nằm trong drawer, không ép menu nhiều tầng vào viewport.

### Ledger Rows

- **Style:** hàng có viền dưới mảnh, nhận diện đối tượng ở trái và thao tác ở phải.
- **Use:** dùng cho học liệu, đề thi, kết quả và các tập dữ liệu cần so sánh; không thay bằng lưới card khi không có nhu cầu quét hình ảnh.

## Do's and Don'ts

### Do:

- **Do** dùng nền giấy, đường kẻ và phân cấp typography để tổ chức dữ liệu trước khi thêm màu.
- **Do** giữ mỗi màn hình một hành động chính có sắc đỏ gạch hoặc nền mực điều phối.
- **Do** chuyển sidebar sang drawer ở màn hình nhỏ để trả không gian cho nội dung.

### Don't:

- **Don't** biến danh sách dữ liệu thành lưới thẻ bo tròn, bóng đổ và chỉ số trang trí.
- **Don't** dùng gradient, màu accent bão hòa khắp màn hình hoặc badge nhiều màu không có ý nghĩa nghiệp vụ.
- **Don't** đặt nhãn viết hoa trang trí phía trên mọi tiêu đề; tiêu đề phải nói thẳng công việc của trang.
- **Don't** dùng serif trong dashboard hoặc màn hình vận hành; phân cấp bằng weight, size và khoảng trắng.
