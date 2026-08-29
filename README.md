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
3. Cấu hình Cloudinary: đặt `STORAGE_PROVIDER=cloudinary`, sau đó điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. `CLOUDINARY_FOLDER=wind-edu` là thư mục gốc; tệp được upload dạng `authenticated` và chỉ được backend tải sau khi kiểm tra quyền.
4. Tạo database riêng cho dự án bằng MySQL Workbench hoặc MySQL Shell:

```sql
CREATE DATABASE trung_tam_giang_day
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

5. Cài dependency và sinh Prisma Client:

```powershell
pnpm install
pnpm db:generate
```

6. Đặt `SEED_DEFAULT_PASSWORD` bằng mật khẩu khởi tạo dài ít nhất 12 ký tự. Biến này chỉ dùng để tạo tài khoản mẫu và không được commit.

7. Chỉ sau khi đã kiểm tra đúng bộ biến `DB_*`, triển khai migration đã được kiểm thử và nạp dữ liệu nền:

```powershell
pnpm db:doctor
pnpm db:deploy
pnpm db:seed
```

`db:doctor` kiểm tra năm biến `DB_*`, độ dài mật khẩu seed, quyền đăng nhập, database và lịch sử migration mà không in mật khẩu. Thêm `--json` để nhận kết quả máy đọc được hoặc `--verbose` để xem lỗi kết nối đầy đủ. `db:deploy` chỉ áp dụng các migration có sẵn trong repository; `db:migrate` dành cho lập trình viên khi chủ động thay đổi schema. Không chạy migration trên database đang chứa dữ liệu ngoài dự án. `.env` đã bị loại khỏi Git; chỉ `.env.example` được phép commit.

## Chạy phát triển

```powershell
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api/v1/health`
- Swagger: `http://localhost:4000/api/docs`

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
