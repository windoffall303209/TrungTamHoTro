# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Wind EDU phục vụ bốn nhóm người dùng có tầm quan trọng ngang nhau:

- Quản trị hệ thống quản lý người dùng, vai trò, phân quyền, cấu hình và tình trạng vận hành.
- Quản lý trung tâm điều hành khóa học, lớp, phân công giảng viên, điểm danh, vòng đời lớp và báo cáo.
- Giảng viên tổ chức hoạt động giảng dạy, học liệu, câu hỏi, đề thi, chấm bài, diễn đàn và lớp học online.
- Học viên tham gia lớp, sử dụng học liệu, làm bài, xem kết quả, trao đổi và yêu cầu hỗ trợ.

## Product Purpose

Wind EDU là nền tảng hỗ trợ giảng dạy tích hợp. Sản phẩm đưa dữ liệu, ngân hàng câu hỏi và đề thi, diễn đàn trao đổi, lớp học online cùng các nghiệp vụ vận hành liên quan vào một không gian làm việc dùng chung.

Thành công nghĩa là mỗi vai trò có thể hoàn thành công việc của mình trong cùng một hệ thống, trong khi dữ liệu và trạng thái nghiệp vụ được truyền xuyên suốt giữa các vai trò mà không phải quản lý bằng nhiều công cụ rời rạc.

## Positioning

Wind EDU không chia người dùng thành bốn hệ thống độc lập. Một nền tảng, một nguồn dữ liệu và một cơ chế phân quyền tạo ra trải nghiệm phù hợp theo vai trò, đồng thời giữ toàn bộ vòng đời dạy và học liên kết với nhau.

## Operating Context

- Quản lý trung tâm tạo và vận hành khóa học, lớp, lịch học và phân công.
- Giảng viên tiếp nhận lớp được phân công, cung cấp học liệu, tổ chức đánh giá, trao đổi và buổi học trực tuyến.
- Học viên học tập, làm bài, nhận kết quả, tham gia trao đổi và theo dõi lịch sử học tập.
- Quản trị hệ thống duy trì tài khoản, quyền truy cập, cấu hình, tích hợp và sức khỏe hệ thống.
- Thông báo, hỗ trợ, báo cáo và dữ liệu lớp kết nối các luồng nghiệp vụ giữa bốn vai trò.

## Capabilities and Constraints

- Bốn phân hệ cốt lõi: kho dữ liệu và học liệu, ngân hàng câu hỏi và đề thi, diễn đàn trao đổi, lớp học online.
- Các nghiệp vụ hỗ trợ: khóa học và lớp, điểm danh, vòng đời lớp, kết quả học tập, hỗ trợ, báo cáo và vận hành hệ thống.
- Phân quyền theo bốn vai trò: `SYSTEM_ADMIN`, `CENTER_MANAGER`, `INSTRUCTOR`, `LEARNER`.
- Giao diện web hiện dùng tiếng Việt và phải giữ thuật ngữ nghiệp vụ nhất quán.
- Frontend dùng Next.js, React, TypeScript và Tailwind CSS trong pnpm monorepo.
- Backend dùng NestJS REST API; dữ liệu dùng chung qua Prisma và MySQL 8.
- MySQL chạy trực tiếp trên máy; dự án không sử dụng Docker.
- Cấu hình môi trường thật nằm trong `.env` và không được commit.

## Brand Commitments

- Tên sản phẩm hiện tại: Wind EDU.
- Tên mô tả: Trung tâm hỗ trợ giảng dạy.
- Sản phẩm ưu tiên ngôn ngữ rõ ràng, trực tiếp và đúng ngữ cảnh giáo dục bằng tiếng Việt.
- Không biến bốn vai trò thành bốn sản phẩm hoặc bốn thương hiệu tách rời.

## Evidence on Hand

- Mô tả kiến trúc và cách vận hành: `../../README.md`.
- Giao diện khung, điều hướng và phân quyền theo vai trò: `src/components/workspace-shell.tsx`.
- Phiên làm việc mẫu và quyền của bốn vai trò: `src/providers/app-provider.tsx`.
- Các route nghiệp vụ: `src/app/(workspace)`.
- Kiểu dữ liệu dùng chung: `../../packages/contracts`.
- Ma trận kiểm chứng chức năng: `../../docs/acceptance-matrix.md`.
- Chưa có bằng chứng công khai về khách hàng, số liệu sử dụng, chứng nhận, giá bán hoặc cam kết thương mại; công việc thiết kế sau này không được tự tạo các tuyên bố này.

## Product Principles

1. Một nguồn dữ liệu dùng chung cho toàn bộ vòng đời dạy và học.
2. Bốn vai trò ngang nhau về tầm quan trọng, khác nhau rõ ràng về quyền và nhiệm vụ.
3. Mỗi màn hình phải giúp người dùng hoàn thành một công việc nghiệp vụ cụ thể.
4. Trạng thái, thông báo và kết quả phải truyền xuyên suốt giữa các vai trò.
5. Ưu tiên tính đúng đắn, khả năng kiểm chứng và vận hành thực tế hơn chức năng trình diễn.

## Accessibility & Inclusion

- Giao diện phải sử dụng được bằng bàn phím và cung cấp nhãn truy cập cho các điều khiển tương tác.
- Nội dung trạng thái không được chỉ phụ thuộc vào màu sắc.
- Chuyển động phải tôn trọng thiết lập `prefers-reduced-motion`.
- Bố cục phải hỗ trợ màn hình máy tính và thiết bị di động mà không làm mất nghiệp vụ cốt lõi.
