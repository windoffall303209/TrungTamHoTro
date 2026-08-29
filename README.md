# Trung tâm hỗ trợ giảng dạy

Codebase nền cho hệ thống phục vụ bốn phân hệ: lưu trữ dữ liệu, ngân hàng câu hỏi, diễn đàn trao đổi và lớp học online.

## Công nghệ

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS 4.
- Backend: NestJS 11, REST API có versioning và OpenAPI.
- Database: MySQL 8 cài trực tiếp trên máy, Prisma ORM 7.
- Workspace: pnpm monorepo.
- Chất lượng: ESLint, TypeScript strict, Vitest và build kiểm chứng.

## Cấu trúc

```text
apps/
  api/        NestJS API và Prisma schema
  web/        Next.js App Router
packages/
  contracts/  Kiểu dữ liệu dùng chung
docs/         Kiến trúc và hướng dẫn phát triển
```

## Yêu cầu

- Node.js 24 trở lên.
- pnpm 11 trở lên.
- MySQL 8 đang chạy trên máy. Dự án không dùng Docker.

## Thiết lập lần đầu

1. Mở file `.env` ở thư mục gốc và cấu hình `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` theo MySQL cục bộ.
2. Cấu hình Resend bằng đúng hai biến `RESEND_API_KEY` và `RESEND_FROM`. Production phải dùng domain đã xác minh, ví dụ `RESEND_FROM=WIND OF FALL <noreply@windoffall3k32k9.online>`.
3. Cấu hình Google OAuth bằng `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` và `GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback`. Trong Google Cloud Console, thêm chính xác URL callback này vào **Authorized redirect URIs** và thêm `http://localhost:3000` vào **Authorized JavaScript origins**.
4. Cấu hình Cloudinary: đặt `STORAGE_PROVIDER=cloudinary`, sau đó điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. `CLOUDINARY_FOLDER=wind-edu` là thư mục gốc; tệp được upload dạng `authenticated` và chỉ được backend tải sau khi kiểm tra quyền.
5. Tạo database riêng cho dự án bằng MySQL Workbench hoặc MySQL Shell:

```sql
CREATE DATABASE trung_tam_giang_day
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

6. Cài dependency và sinh Prisma Client:

```powershell
pnpm install
pnpm db:generate
```

7. Đặt `SEED_DEFAULT_PASSWORD` bằng mật khẩu khởi tạo dài ít nhất 12 ký tự. Biến này chỉ dùng để tạo tài khoản mẫu và không được commit.

8. Chỉ sau khi đã kiểm tra đúng bộ biến `DB_*`, triển khai migration đã được kiểm thử và nạp dữ liệu nền:

```powershell
pnpm db:doctor
pnpm db:deploy
pnpm db:seed
```

Lệnh seed tạo bộ dữ liệu thử nghiệm lớn và có thể chạy lại an toàn: 60 học viên, 6 giảng viên, 8 khóa học, 12 lớp, hơn 300 lượt ghi danh cùng dữ liệu tài liệu, câu hỏi, đề thi, bài làm, diễn đàn, lớp trực tuyến, điểm danh, thông báo và yêu cầu hỗ trợ. Tất cả tài khoản mẫu dùng mật khẩu trong `SEED_DEFAULT_PASSWORD`. Nếu terminal chưa nhận `pnpm`, chạy tương đương bằng `npm --prefix apps/api run db:seed`.

`db:doctor` kiểm tra năm biến `DB_*`, độ dài mật khẩu seed, quyền đăng nhập, database và lịch sử migration mà không in mật khẩu. Thêm `--json` để nhận kết quả máy đọc được hoặc `--verbose` để xem lỗi kết nối đầy đủ. `db:deploy` chỉ áp dụng các migration có sẵn trong repository; `db:migrate` dành cho lập trình viên khi chủ động thay đổi schema. Không chạy migration trên database đang chứa dữ liệu ngoài dự án. `.env` đã bị loại khỏi Git; chỉ `.env.example` được phép commit.

## Chạy phát triển

```powershell
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api/v1/health`
- Swagger: `http://localhost:4000/api/docs`

## Tài khoản và xác minh

- Người dùng đăng nhập bằng trường `Tài khoản` (`username`). Migration `20260830160000_legacy_username_email_and_pending_email_change` đặt username của toàn bộ tài khoản đã tồn tại bằng email chuẩn hóa; tài khoản đăng ký mới vẫn chọn username riêng.
- Nút `Tiếp tục với Google` dùng Authorization Code + PKCE. Email do Google xác nhận được coi là đã xác minh; tài khoản Google mới có `username=email`, trạng thái `ACTIVE` và chưa có mật khẩu. Nếu email đã thuộc tài khoản nội bộ đang hoạt động hoặc chờ xác minh, hệ thống liên kết an toàn theo email và giữ nguyên các vai trò đã cấp.
- Đăng ký học viên tạo tài khoản ở trạng thái `PENDING_VERIFICATION`. Hệ thống gửi đồng thời mã 6 số và liên kết dùng một lần qua Resend; chỉ sau khi xác minh, trạng thái mới chuyển sang `ACTIVE`.
- Khi email đang chờ xác minh bị nhập sai, người dùng có thể đổi ngay trên trang nhập mã sau khi xác nhận mật khẩu hiện tại. Mã/link cũ bị thu hồi và một bộ xác minh mới được gửi tới email mới; tài khoản cũ có username=email tiếp tục được đồng bộ theo email mới.
- Trang xác minh kiểm tra trạng thái mỗi 3 giây và đồng bộ giữa hai tab bằng `BroadcastChannel` cùng sự kiện `storage`. Vì vậy, mở liên kết trong tab mới sẽ tự hoàn tất trang đang chờ.
- Xác thực hai bước dùng TOTP tương thích Google Authenticator, Microsoft Authenticator, 1Password, Authy và Bitwarden. Giao diện cung cấp QR, khóa nhập tay và mã khôi phục một lần.
- Với tài khoản liên kết Google, đặt/đổi mật khẩu, bắt đầu bật 2FA và bắt đầu tắt 2FA dùng mã 6 số gửi qua email thay cho mật khẩu hiện tại. Mã có hạn 10 phút, chỉ dùng một lần, bị khóa sau 5 lần sai và không thể dùng chéo mục đích.
- Tắt xác thực hai bước bắt buộc hai bước độc lập: tài khoản cục bộ xác nhận mật khẩu, tài khoản Google xác nhận OTP email; sau đó cả hai đều phải nhập TOTP trong phiên thử thách có hạn 5 phút.
- Tài khoản seed đăng nhập bằng `admin@wind.edu.vn`, `manager@wind.edu.vn`, `instructor@wind.edu.vn`, `learner@wind.edu.vn`; mật khẩu lấy từ `SEED_DEFAULT_PASSWORD`.

Mặc định `DATABASE_CONNECT_ON_START=false`, vì vậy API có thể khởi động trước khi điền mật khẩu. Chuyển thành `true` sau khi `db:deploy` và `db:seed` thành công.

## Chế độ lưu dữ liệu

- `DATABASE_CONNECT_ON_START=false`: API dùng dữ liệu mẫu trong bộ nhớ để phát triển giao diện và chạy kiểm thử; thay đổi sẽ mất khi khởi động lại.
- `DATABASE_CONNECT_ON_START=true`: toàn bộ định danh, khóa học, lớp, học liệu, đánh giá, diễn đàn, lớp trực tuyến, hỗ trợ, báo cáo và cấu hình vận hành đọc/ghi qua Prisma/MySQL.

Không bật chế độ MySQL trước khi `pnpm db:deploy` và `pnpm db:seed` đều thành công. Health overview sẽ trả trạng thái `degraded` khi kết nối database bị tắt, tránh báo xanh sai trạng thái.

## Kiểm tra chất lượng

```powershell
pnpm check
```

Lệnh này chạy lần lượt lint, typecheck, test và build cho toàn bộ workspace.

## Quy ước cấu hình

- `.env`: giá trị thật trên máy của từng thành viên, tuyệt đối không commit.
- `.env.example`: danh sách biến bắt buộc và giá trị mẫu không chứa bí mật.
- Biến mới phải được khai báo đồng thời trong `.env.example` và bộ kiểm tra tại `apps/api/src/config/environment.ts`. Kết nối database dùng trực tiếp bộ biến `DB_*`; không khai báo thêm `DATABASE_URL` để tránh hai nguồn cấu hình xung đột.
