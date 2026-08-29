# Wind EDU — Trung tâm hỗ trợ giảng dạy

Wind EDU là hệ thống vận hành trung tâm giảng dạy trong một không gian làm việc thống nhất. Sản phẩm kết hợp quản lý dữ liệu học tập, ngân hàng câu hỏi và đánh giá, diễn đàn trao đổi, lớp học trực tuyến, quản trị tài khoản, hỗ trợ người dùng và báo cáo vận hành.

## Chức năng chính

### Lưu trữ và quản lý học liệu

- Tổ chức học liệu theo lớp, thư mục, nhãn và trạng thái hiển thị.
- Upload tệp lên Cloudinary; backend kiểm tra quyền trước khi tải.
- Quản lý phiên bản, lịch sử truy cập, kiểm duyệt và cách ly tệp.
- Theo dõi dung lượng lưu trữ theo lớp và toàn trung tâm.

### Ngân hàng câu hỏi và đánh giá

- Quản lý câu hỏi một lựa chọn, nhiều lựa chọn, đúng/sai, trả lời ngắn và tự luận.
- Phiên bản hóa, phát hành, nhập hàng loạt và phân loại câu hỏi.
- Tạo đề, xáo câu hỏi có thể tái lập, giới hạn lượt thi và duyệt đề.
- Làm bài, lưu đáp án, chấm điểm, công bố kết quả, phúc khảo và lưu lịch sử sửa điểm.
- Quản lý bài tập, rubric, bài nộp và gradebook theo lớp.

### Diễn đàn trao đổi

- Tạo chủ đề, bài trả lời, nhắc tên thành viên và đính kèm học liệu.
- Ghim, khóa, chỉnh sửa, ẩn và xóa mềm nội dung.
- Báo cáo nội dung, nhận xử lý, phân cấp, giải quyết và khiếu nại.
- Gửi thông báo theo sự kiện và trạng thái đã đọc.

### Lớp học trực tuyến

- Lập lịch buổi học, quản lý trạng thái và thay đổi lịch.
- Hỗ trợ Google Meet, Zoom và Jitsi theo cấu hình tích hợp.
- Thử lại và chuyển nhà cung cấp dự phòng khi tạo phòng thất bại.
- Đồng bộ điểm danh, khóa bảng điểm danh và xử lý khiếu nại.
- Quản lý trạng thái và quyền truy cập bản ghi buổi học.

### Nghiệp vụ hỗ trợ

- Quản lý khóa học, phiên bản khóa học, lớp, giảng viên và học viên.
- Thông báo lớp, lịch tổng, tiến độ học tập và can thiệp học viên.
- Phiếu hỗ trợ theo danh mục, mức độ nghiêm trọng, SLA, bình luận và tệp đính kèm.
- Báo cáo vận hành, phân tích đề thi, xuất dữ liệu, sao lưu, khôi phục, retention và audit log.

## Vai trò và phân quyền

Bốn vai trò là các nhóm người dùng ngang hàng trong mô hình nghiệp vụ; mỗi vai trò có phạm vi trách nhiệm và bộ quyền riêng.

| Vai trò | Phạm vi chính |
| --- | --- |
| Quản trị hệ thống | Tài khoản, vai trò, cấu hình, tích hợp, sao lưu, retention, cảnh báo và audit |
| Quản lý trung tâm | Khóa học, lớp, phân công, ghi danh, duyệt đề, kiểm duyệt và báo cáo |
| Giảng viên | Học liệu, câu hỏi, đề thi, bài tập, diễn đàn, lớp trực tuyến và điểm danh |
| Học viên | Lớp đã ghi danh, học liệu, bài tập, bài thi, diễn đàn, buổi học và hỗ trợ |

Backend luôn kiểm tra quyền. Việc ẩn nút trên frontend chỉ phục vụ trải nghiệm và không thay thế kiểm soát truy cập phía server.

## Công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Backend | NestJS 11, REST API có version, Swagger/OpenAPI |
| Database | MySQL 8, Prisma ORM 7, MariaDB adapter |
| Email | Resend |
| Object storage | Cloudinary authenticated assets |
| Xác thực | Server session, CSRF, Google OAuth + PKCE, TOTP MFA |
| Kiểm thử | Vitest, Testing Library, Playwright, axe-core |
| Workspace | pnpm monorepo |

Dự án chạy trực tiếp trên máy và không sử dụng Docker.

## Cấu trúc repository

```text
TestDoAn/
├── apps/
│   ├── api/
│   │   ├── prisma/             # Schema, migration và seed MySQL
│   │   ├── src/auth/           # Đăng nhập, Google OAuth, MFA
│   │   ├── src/identity/       # Người dùng, vai trò và quyền
│   │   ├── src/learning/       # Nghiệp vụ giảng dạy
│   │   └── src/system/         # Vận hành hệ thống
│   └── web/
│       ├── src/app/            # Trang và route Next.js
│       ├── src/components/     # Thành phần giao diện
│       └── e2e/                # Playwright E2E
├── packages/contracts/         # Kiểu dữ liệu dùng chung
├── docs/                       # Kiến trúc và tài liệu nghiệm thu
├── scripts/                    # Load test và công cụ hỗ trợ
└── .env.example                # Mẫu cấu hình không chứa bí mật
```

## Yêu cầu môi trường

- Node.js 24 trở lên.
- MySQL 8 đang chạy trên máy.
- Git.
- pnpm 11 qua Corepack; npm có thể chạy riêng từng ứng dụng.

```powershell
node --version
npm --version
corepack --version
```

## Cài đặt lần đầu

### Cách khuyến nghị

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
corepack pnpm install
Copy-Item .env.example .env
```

Nếu PowerShell nhận trực tiếp lệnh `pnpm`, có thể bỏ tiền tố `corepack`.

Repository dùng pnpm workspace. Khi dependency đã được cài, npm vẫn có thể chạy từng ứng dụng:

```powershell
npm --prefix apps/api run dev
npm --prefix apps/web run dev
```

## Cấu hình môi trường

Không commit `.env`. Khóa thật chỉ được lưu trên máy hoặc secret manager của môi trường triển khai.

### Ứng dụng và API

```dotenv
NODE_ENV=development
WEB_PORT=3000
API_PORT=4000
API_PREFIX=api
API_VERSION=1
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

### MySQL

```dotenv
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=trung_tam_giang_day
DB_PORT=3306
DATABASE_CONNECT_ON_START=true
DB_BACKUP_TIMEOUT_MS=30000
SEED_DEFAULT_PASSWORD=YOUR_DEMO_PASSWORD_AT_LEAST_12_CHARACTERS
```

Hệ thống chỉ dùng bộ biến `DB_*`; không thêm `DATABASE_URL` để tránh hai nguồn cấu hình xung đột.

### Google OAuth

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback
```

Cấu hình Google Cloud Console:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:4000/api/v1/auth/google/callback`

Giá trị phải khớp tuyệt đối cả giao thức, host, port và path.

### Email qua Resend

```dotenv
RESEND_API_KEY=
RESEND_FROM=WIND OF FALL <noreply@your-verified-domain.example>
```

Địa chỉ gửi phải thuộc domain đã xác minh trên Resend.

### Cloudinary

```dotenv
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=wind-edu
```

### Bảo mật và vận hành

```dotenv
AUTH_ENCRYPTION_SECRET=CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS
STORAGE_SIGNING_SECRET=CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS
STORAGE_ROOT=C:/path/to/TestDoAn-data
MFA_ISSUER=Wind EDU
RATE_LIMIT_TTL_MS=60000
RATE_LIMIT_MAX=100
LOG_LEVEL=info
ANTIVIRUS_PROVIDER=disabled
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=15000
LIVE_PROVIDER_RETRY_LIMIT=2
LIVE_PROVIDER_FALLBACK_ORDER=GOOGLE_MEET,ZOOM,JITSI
LIVE_PROVIDER_SIMULATED_FAILURES=
```

Production phải thay toàn bộ secret mẫu, bật antivirus phù hợp và không dùng giá trị phát triển.

## Khởi tạo MySQL

```sql
CREATE DATABASE trung_tam_giang_day
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Kiểm tra kết nối, triển khai migration và nạp dữ liệu:

```powershell
corepack pnpm db:doctor
corepack pnpm db:deploy
corepack pnpm db:seed
```

Seed bằng npm:

```powershell
npm --prefix apps/api run db:seed
```

| Lệnh | Mục đích |
| --- | --- |
| `db:doctor` | Kiểm tra biến DB, mật khẩu seed, kết nối, schema và migration mà không in bí mật |
| `db:deploy` | Áp dụng migration đã có trong repository |
| `db:migrate` | Tạo migration khi chủ động thay đổi schema |
| `db:seed` | Nạp dữ liệu nền và dữ liệu thử nghiệm có thể chạy lặp lại |
| `db:studio` | Mở Prisma Studio để xem dữ liệu |

Không chạy migration của dự án trên database chứa dữ liệu không thuộc Wind EDU.

## Dữ liệu thử nghiệm

Seed tạo dữ liệu đủ lớn để kiểm tra phân trang, bộ lọc, dashboard và các luồng liên kết:

| Nhóm dữ liệu | Số lượng |
| --- | ---: |
| Tài khoản mới | 66 |
| Khóa học / lớp | 8 / 12 |
| Lượt ghi danh | 326 |
| Học liệu / câu hỏi | 72 / 120 |
| Đề thi / lượt làm bài | 24 / 414 |
| Bài tập / bài nộp | 36 / 700 |
| Chủ đề / bài viết diễn đàn | 48 / 288 |
| Buổi học / lượt điểm danh | 60 / 528 |
| Thông báo / phiếu hỗ trợ | 240 / 36 |

Seed dùng mã định danh cố định và chống trùng, vì vậy có thể chạy lại mà không nhân bản dữ liệu thử nghiệm.

## Chạy dự án

### Frontend và backend cùng lúc

```powershell
corepack pnpm dev
```

### Hai terminal riêng

```powershell
# Terminal 1
corepack pnpm dev:api

# Terminal 2
corepack pnpm dev:web
```

Hoặc bằng npm:

```powershell
npm --prefix apps/api run dev
npm --prefix apps/web run dev
```

| Dịch vụ | URL |
| --- | --- |
| Web | [http://localhost:3000](http://localhost:3000) |
| API health | [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health) |
| Swagger | [http://localhost:4000/api/docs](http://localhost:4000/api/docs) |
| Metrics | [http://localhost:4000/api/v1/observability/metrics](http://localhost:4000/api/v1/observability/metrics) |

Với `DATABASE_CONNECT_ON_START=true`, dữ liệu đọc/ghi qua MySQL. Khi đặt `false`, API dùng dữ liệu trong bộ nhớ và thay đổi sẽ mất sau khi khởi động lại.

## Tài khoản thử nghiệm

Tất cả tài khoản seed dùng mật khẩu trong `SEED_DEFAULT_PASSWORD`.

| Vai trò | Tài khoản |
| --- | --- |
| Quản trị hệ thống | `admin@wind.edu.vn` |
| Quản lý trung tâm | `manager@wind.edu.vn` |
| Giảng viên chính | `instructor@wind.edu.vn` |
| Giảng viên bổ sung | `giangvien01@wind.edu.vn` đến `giangvien06@wind.edu.vn` |
| Học viên chính | `learner@wind.edu.vn` |
| Học viên bổ sung | `hocvien001@wind.edu.vn` đến `hocvien060@wind.edu.vn` |

Trường đăng nhập là `Tài khoản` (`username`). Với tài khoản seed và tài khoản cũ, username chính là email.

## Xác thực và bảo mật tài khoản

- Đăng ký tạo tài khoản `PENDING_VERIFICATION` và gửi đồng thời mã 6 số cùng liên kết xác minh.
- Người dùng có thể sửa email nhập sai trong luồng xác minh sau khi xác nhận mật khẩu.
- Trang xác minh tự đồng bộ giữa các tab.
- Google OAuth dùng Authorization Code + PKCE; email Google được xem là đã xác minh.
- Tài khoản Google có `username=email`, ban đầu không có mật khẩu và dùng OTP email cho bước nhạy cảm.
- MFA dùng TOTP, QR, khóa nhập tay và mã khôi phục một lần.
- Tắt MFA yêu cầu xác minh danh tính, sau đó xác nhận TOTP trong thử thách có thời hạn.
- Session lưu phía server, dùng cookie, CSRF protection, rate limit và cho phép thu hồi từng phiên.

## Kiểm tra chất lượng

```powershell
corepack pnpm check
```

Lệnh trên chạy ESLint, TypeScript typecheck, toàn bộ test và production build. Các lệnh riêng:

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:load
```

## Tài liệu kỹ thuật

- [Kiến trúc hệ thống](docs/architecture.md)
- [Luồng xác thực](docs/authentication-flow.md)
- [Ma trận nghiệm thu](docs/acceptance-matrix.md)
- [Kiểm kê chức năng](docs/function-audit-2026-08-28.md)
- [Rà soát dự án](docs/project-audit-2026-08-29.md)
- [Trạng thái khắc phục](docs/remediation-status-2026-08-29.md)
- [Báo cáo bảo mật](security_best_practices_report.md)
- [Định hướng sản phẩm](apps/web/PRODUCT.md)
- [Quy chuẩn giao diện](apps/web/DESIGN.md)

## Xử lý lỗi thường gặp

### PowerShell không nhận pnpm

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
corepack pnpm install
```

### API báo database degraded hoặc không có dữ liệu

1. Kiểm tra MySQL đang chạy và năm biến `DB_*`.
2. Đặt `DATABASE_CONNECT_ON_START=true`.
3. Chạy `corepack pnpm db:doctor`, `db:deploy`, `db:seed`.
4. Khởi động lại API.

### Google OAuth báo offline hoặc thất bại

- Đảm bảo API chạy ở port 4000.
- Kiểm tra `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`.
- Kiểm tra callback khớp tuyệt đối với Authorized redirect URI.
- Không dùng lẫn `localhost` và `127.0.0.1` trong cùng luồng OAuth.
- Kiểm tra OAuth consent screen và tài khoản test trên Google Cloud Console.

### Resend hoặc Cloudinary không hoạt động

- Resend: kiểm tra API key và domain của `RESEND_FROM` đã xác minh.
- Cloudinary: kiểm tra cloud name, API key, API secret và `STORAGE_PROVIDER=cloudinary`.
- Xem log API để xác định lỗi quyền, kích thước, MIME type hoặc antivirus.

## Quy ước đóng góp

- Không commit `.env`, secret, khóa API hoặc dữ liệu người dùng thật.
- Biến mới phải có trong `.env.example` và bộ kiểm tra cấu hình backend.
- Thay đổi database phải đi qua Prisma migration và `db:doctor`.
- Nghiệp vụ mới phải kiểm tra quyền ở backend và có test tương ứng.
- Chạy `corepack pnpm check` trước khi commit.
- Commit viết bằng tiếng Việt có dấu và mô tả rõ phạm vi thay đổi.
