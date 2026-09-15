# Wind EDU

Wind EDU là nền tảng vận hành trung tâm giảng dạy song ngữ Việt–Anh. Hệ thống kết nối quản lý khóa học và lớp, học liệu, bài tập, đề thi, chấm điểm, giao tiếp, hỗ trợ người dùng, báo cáo vận hành và các công cụ AI trong một workspace thống nhất.

Backend áp dụng quyền theo vai trò, quan hệ với lớp và trạng thái nghiệp vụ. Các thao tác quan trọng dùng transaction, khóa phiên bản, audit và idempotency; việc ẩn nút trên giao diện không thay thế kiểm tra quyền ở API.

## Tính năng

### Khóa học, lớp và học liệu

- Quản lý khóa học theo phiên bản; lớp ghim đúng snapshot chương trình đang sử dụng.
- Phân công giảng viên chính/đồng giảng viên, bàn giao trách nhiệm và kiểm tra trùng lịch thực tế.
- Ghi danh thủ công hoặc hàng loạt, giới hạn sĩ số, ghi danh muộn và gỡ/ghi danh lại an toàn.
- Không gian lớp tập trung: tổng quan, học tập, đánh giá, thành viên và trao đổi.
- Kho tài liệu tổ chức theo khóa học, môn học và lớp; có phiên bản, kiểm duyệt, ẩn, cách ly và thu hồi.
- Tệp được kiểm tra MIME, kích thước, checksum và quyền trước khi tải; liên kết tải có thời hạn.

### Bài tập, đề thi và kết quả

- Bài tập có lịch sử chỉnh sửa, công bố, gia hạn, đóng bài, rubric và nhiều lần nộp.
- Bài nộp hỗ trợ nội dung trực tiếp và tối đa 5 tệp; chấm lần đầu được phân biệt với sửa điểm đã công bố.
- Ngân hàng câu hỏi hỗ trợ một đáp án, nhiều đáp án, đúng/sai, điền ngắn và tự luận.
- Câu hỏi và ảnh được phiên bản hóa; đề nháp có thể sửa trực tiếp nội dung, lựa chọn, đáp án và điểm từng câu.
- Quy trình đề thi: nháp → gửi duyệt → duyệt/trả lại → phát hành → làm bài → chấm → công bố kết quả.
- Học viên được tự động lưu đáp án, tự động nộp theo đồng hồ server và không tạo lượt nộp trùng.
- Kết quả, gradebook, báo cáo tiến độ, lịch sử sửa điểm và phúc khảo sử dụng cùng quy tắc nghiệp vụ.

### Chat, diễn đàn và thông báo

- Danh bạ theo lớp, tìm người dùng có hoặc không dấu và mở đúng hội thoại trong tối đa hai thao tác.
- Một hội thoại riêng duy nhất cho mỗi cặp người dùng; chat lớp tự đồng bộ membership và chuyển chỉ đọc khi lớp đóng.
- Tin nhắn realtime qua SSE, cursor pagination, unread, read receipt, reply, mention, tìm kiếm, mute, report và block.
- Gửi văn bản, ảnh và tệp có idempotency; composer dùng Enter để gửi và Shift+Enter để xuống dòng.
- Preview ảnh trực tiếp, nhóm tin theo mốc 30 phút và chỉ hiện thao tác trả lời khi hover/focus.
- Thẻ ngữ cảnh bài học/bài nộp luôn kiểm tra lại quyền của người nhận trước khi trả dữ liệu.
- Diễn đàn hỗ trợ ghim, khóa, chỉnh sửa, ẩn, báo cáo, nhận xử lý, chuyển cấp, kháng nghị và khôi phục.
- Thông báo có deep link đúng đối tượng, click-outside để đóng và đồng bộ trạng thái đã đọc.

### Lớp trực tuyến, điểm danh và hỗ trợ

- Lập lịch và thay đổi buổi học có kiểm tra cửa sổ thời gian và múi giờ.
- Jitsi hoạt động trực tiếp; Google Meet và Zoom chỉ được bật sau khi có OAuth/webhook production hợp lệ.
- Điểm danh theo các khoảng tham dự, đồng bộ provider, khóa kỳ điểm danh và xử lý yêu cầu điều chỉnh.
- Bản ghi chỉ cấp URL sau cổng kiểm tra trạng thái, thời hạn và quyền hiện tại.
- Phiếu hỗ trợ có SLA, người xử lý, trao đổi, tệp bằng chứng, kết quả và xác nhận đóng của người gửi.
- Can thiệp học tập hỗ trợ giao việc, nhận việc, bàn giao, hoàn tất hoặc hủy kèm kết quả/lý do.

### AI có kiểm soát

- Hỗ trợ Gemini, OpenAI, NVIDIA NIM và provider Custom tương thích OpenAI.
- Admin quản lý API key, provider/model riêng cho sinh đề, quét ảnh, OCR tài liệu, hỏi đáp, bộ ôn tập và chấm bài.
- Có thể tải danh sách model theo chính API key hiện tại hoặc nhập model thủ công; danh sách được chuẩn hóa và giới hạn kích thước.
- Tạo đề theo số lượng, ma trận loại câu, độ khó, ngôn ngữ và ngữ cảnh tài liệu của khóa học.
- Khi không có tài liệu phù hợp, luồng sinh đề có thể dùng tìm kiếm Internet nếu provider/tác vụ được cấu hình hỗ trợ.
- Kết quả sinh đề được sửa trực tiếp trước khi duyệt; hệ thống kiểm tra ma trận, cấu trúc đáp án và câu hỏi trùng.
- Hỏi đáp tài liệu trả nguồn trích dẫn, ghim đúng phiên bản và lưu lịch sử riêng theo người dùng.
- Bộ ôn tập tạo tóm tắt và flashcard, cho phép sửa, phát hành và thu hồi mà không đổi snapshot đã phát hành.
- Chấm AI theo rubric từ văn bản, TXT, DOCX, PDF, PNG, JPEG và WebP; DOCX được đọc cục bộ, PDF/ảnh dùng OCR.
- Gợi ý AI không tự lưu điểm: giảng viên phải xem nguồn, xác nhận và chủ động áp dụng.

### Chống gọi AI trùng

Các tác vụ sinh đề, OCR, hỏi đáp, bộ ôn tập và chấm bài dùng claim bền vững trong PostgreSQL:

- Khóa được tạo trước khi gọi provider và gắn với người dùng, nguồn, phiên bản cùng fingerprint yêu cầu.
- Kết quả `READY` được phát lại sau khi process restart mà không cần gọi provider.
- Trạng thái `GENERATING` hoặc `UNCERTAIN` không được tự động retry để tránh tính phí hai lần.
- Admin chỉ có thể mở lại sau khi ghi bằng chứng provider chưa tiếp nhận, xử lý hoặc tính phí.
- Việc mở lại dùng CAS và audit nguyên tử, chuyển sang `RETRY_AUTHORIZED`; nhiều worker cạnh tranh chỉ một worker được gọi provider.
- Không có fallback RAM cho tác vụ AI cần chống trùng; thiếu database bền vững trả lỗi rõ ràng trước khi gọi AI.

### Quản trị và vận hành

- Tài khoản nhiều vai trò, ma trận quyền, impact preview và bàn giao công việc trước khi đổi quyền.
- Đăng ký/xác minh email, Google OAuth + PKCE, phiên server-side, CSRF, TOTP MFA và mã khôi phục.
- Báo cáo, export tệp thật, backup, restore drill/operational và background worker có lease/retry.
- Retention theo policy/version, archive checksum, kiểm tra khả năng phục hồi và cơ chế phê duyệt bốn mắt.
- Legal hold có vòng đời tạo, xem và giải tỏa; danh mục `AI_RESULTS` quản lý kết quả AI đã hoàn tất.
- Audit log, health overview, metrics, outbox, cảnh báo và hàng đợi đối soát AI metadata-only.

### Song ngữ Việt–Anh

- Toàn bộ workspace hỗ trợ `vi-VN` và `en-US`.
- Locale được lưu ở cookie, local storage và hồ sơ người dùng; `html[lang]`, ngày giờ và số đổi theo locale.
- Web gửi `Accept-Language`; API trả thông báo nghiệp vụ tương ứng.
- Nội dung do người dùng tạo, tên khóa học/lớp và tên tệp không bị tự động dịch.
- Quality gate i18n chặn chuỗi giao diện hoặc lỗi API mới chưa có bản dịch.

## Kiến trúc và công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| API | NestJS 11, REST API versioned, Swagger/OpenAPI |
| Dữ liệu | PostgreSQL 18, Prisma ORM 7, node-postgres adapter |
| Realtime | Server-Sent Events |
| Email | Resend với idempotency key |
| Object storage | Local hoặc Cloudinary authenticated assets |
| Xác thực | Server session, CSRF, Google OAuth + PKCE, TOTP MFA |
| Kiểm thử | Vitest, Testing Library, Playwright, axe-core |
| Workspace | pnpm monorepo |

```text
TestDoAn/
├── apps/
│   ├── api/
│   │   ├── prisma/          # Schema, migration và seed PostgreSQL
│   │   ├── scripts/         # Công cụ database thử độc lập
│   │   ├── src/auth/        # Session, OAuth, xác minh và MFA
│   │   ├── src/identity/    # Người dùng, vai trò và quyền
│   │   ├── src/learning/    # Học vụ, đánh giá, chat và lớp trực tuyến
│   │   ├── src/infrastructure/ # Email, storage, backup và antivirus
│   │   └── src/system/      # AI provider và vận hành hệ thống
│   └── web/
│       ├── src/app/         # Route Next.js
│       ├── src/components/  # Giao diện dùng chung và nghiệp vụ
│       ├── src/i18n/        # Runtime và catalog Việt–Anh
│       └── e2e/             # Playwright E2E
├── packages/contracts/      # Hợp đồng dùng chung
├── docs/                    # Tài liệu kỹ thuật chuyên đề
├── scripts/                 # Load test và công cụ workspace
├── CHECK_TASKS.md           # Trạng thái triển khai và nghiệm thu
├── BUSINESS_FLOW_REVIEW.md  # Rà soát luồng nghiệp vụ
└── .env.example             # Mẫu cấu hình không chứa API key thật
```

Dự án chạy trực tiếp trên máy, không yêu cầu Docker.

## Yêu cầu môi trường

- Node.js `>=24`.
- pnpm `>=11` qua Corepack.
- PostgreSQL 18 đang hoạt động.
- Git.

```powershell
node --version
corepack --version
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' --version
```

## Cài đặt nhanh

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
corepack pnpm install
Copy-Item .env.example .env
```

Sửa `.env`, sau đó tạo database:

```sql
CREATE DATABASE trung_tam_giang_day
  WITH OWNER = postgres
       ENCODING = 'UTF8';
```

Kiểm tra cấu hình, áp migration và seed:

```powershell
corepack pnpm db:doctor
corepack pnpm db:deploy
corepack pnpm db:seed
```

Khởi chạy web và API:

```powershell
corepack pnpm dev
```

Hoặc dùng hai terminal:

```powershell
# Terminal 1
corepack pnpm dev:api

# Terminal 2
corepack pnpm dev:web
```

| Dịch vụ | Địa chỉ |
| --- | --- |
| Web | [http://localhost:3000](http://localhost:3000) |
| API | [http://localhost:4000/api/v1](http://localhost:4000/api/v1) |
| Health | [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health) |
| Swagger | [http://localhost:4000/api/docs](http://localhost:4000/api/docs) |
| Metrics | [http://localhost:4000/api/v1/observability/metrics](http://localhost:4000/api/v1/observability/metrics) |

## Cấu hình môi trường

Không commit `.env`, API key, secret, credential provider hoặc dữ liệu người dùng thật.

### Ứng dụng và PostgreSQL

```dotenv
NODE_ENV=development
API_PORT=4000
API_PREFIX=api
API_VERSION=1
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1

DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=CHANGE_ME
DB_NAME=trung_tam_giang_day
DB_PORT=5432
DATABASE_CONNECT_ON_START=true
DB_BACKUP_TIMEOUT_MS=30000
PG_DUMP_PATH=pg_dump
PG_RESTORE_PATH=pg_restore
```

Production và mọi tác vụ AI chống trùng phải dùng `DATABASE_CONNECT_ON_START=true`. Một số fixture phát triển cũ có thể đọc dữ liệu trong bộ nhớ khi database tắt, nhưng không được xem đây là chế độ vận hành thật.

### Lưu trữ

Lưu cục bộ:

```dotenv
STORAGE_PROVIDER=local
STORAGE_ROOT=C:/path/to/wind-edu-data
STORAGE_SIGNING_SECRET=CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS
```

Hoặc Cloudinary:

```dotenv
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=wind-edu
STORAGE_SIGNING_SECRET=CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS
```

### Email và Google OAuth

```dotenv
RESEND_API_KEY=
RESEND_FROM=Wind EDU <noreply@your-verified-domain.example>

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback
AUTH_ENCRYPTION_SECRET=CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS
MFA_ISSUER=Wind EDU
```

Google Cloud Console phải có:

- Authorized JavaScript origin: `http://localhost:3000`.
- Authorized redirect URI: `http://localhost:4000/api/v1/auth/google/callback`.

Ba biến Google phải được cấu hình cùng nhau. `RESEND_FROM` trên production phải dùng domain đã xác minh, không dùng `resend.dev`.

### Antivirus, rate limit và lớp trực tuyến

```dotenv
ANTIVIRUS_PROVIDER=disabled
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=15000

RATE_LIMIT_TTL_MS=60000
RATE_LIMIT_MAX=100
LOG_LEVEL=info

LIVE_PROVIDER_RETRY_LIMIT=2
LIVE_PROVIDER_FALLBACK_ORDER=GOOGLE_MEET,ZOOM,JITSI
LIVE_PROVIDER_SIMULATED_FAILURES=
```

Production yêu cầu `ANTIVIRUS_PROVIDER=clamav`. Các giá trị mô phỏng lỗi provider chỉ phục vụ phát triển/kiểm thử.

## Cấu hình AI

API key AI không được đặt trong source hoặc gửi từ màn hình giảng viên. Sau khi đăng nhập bằng quản trị hệ thống:

1. Mở **Cấu hình hệ thống → AI và quét đề**.
2. Thêm Gemini, OpenAI, NVIDIA NIM hoặc Custom provider.
3. Nhập API key, endpoint nếu cần và chọn model.
4. Dùng **Tải model** để lấy danh sách model tài khoản hiện được phép sử dụng.
5. Chạy kiểm tra kết nối rồi bật provider.
6. Gán provider/model cho từng tác vụ AI.

API key được mã hóa trước khi lưu bằng `AUTH_ENCRYPTION_SECRET`. Model gửi từ client không được dùng để vượt cấu hình tác vụ của admin.

UAT chất lượng, billing và tình huống mất phản hồi vẫn cần API key cùng ngân sách provider thật; test tự động chỉ mô phỏng biên provider để không phát sinh chi phí.

## Dữ liệu seed

`db:seed` có thể chạy lặp lại và dùng mật khẩu trong `SEED_DEFAULT_PASSWORD`.

| Vai trò | Tài khoản mặc định |
| --- | --- |
| Quản trị hệ thống | `admin@wind.edu.vn` |
| Quản lý trung tâm | `manager@wind.edu.vn` |
| Giảng viên | `instructor@wind.edu.vn` |
| Học viên | `learner@wind.edu.vn` |

Trường đăng nhập là `Tài khoản`; với dữ liệu seed, username trùng email. Không dùng mật khẩu seed trong production.

## Database thử độc lập

Các integration test ghi dữ liệu chỉ được chạy trên database có hậu tố `_test`:

```powershell
corepack pnpm --filter @wind-of-fall/api db:test:prepare
```

Reset database thử yêu cầu xác nhận rõ ràng:

```powershell
corepack pnpm --filter @wind-of-fall/api db:test:reset -- --confirm
```

Không chạy lệnh reset hoặc migration của dự án trên database chứa dữ liệu ngoài Wind EDU.

## Kiểm tra chất lượng

Chạy toàn bộ quality gate:

```powershell
corepack pnpm check
```

Các lệnh riêng:

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:load
corepack pnpm --filter @wind-of-fall/web i18n:check
```

Khi kiểm tra một thay đổi có ghi database, phải dùng `trung_tam_giang_day_test`, không dùng database local đang chứa dữ liệu kiểm thử thủ công.

## Tài liệu dự án

- [Checklist triển khai và bằng chứng nghiệm thu](CHECK_TASKS.md)
- [Rà soát toàn bộ luồng nghiệp vụ](BUSINESS_FLOW_REVIEW.md)
- [Đánh giá luồng chấm AI](docs/ai-grading-review.md)
- [Định hướng sản phẩm web](apps/web/PRODUCT.md)
- [Quy chuẩn giao diện web](apps/web/DESIGN.md)

## Trạng thái tích hợp ngoài

- Jitsi: đã có adapter hoạt động.
- Google Meet/Zoom: cần OAuth app, redirect URI, webhook secret và subscription production; hệ thống không tạo URL giả để báo thành công.
- AI provider live: chức năng đã hoàn thiện ở tầng ứng dụng, nhưng UAT chất lượng/billing/log cần credential thật.
- Chat ngoài lớp và nhóm tự tạo: đang deferred đến khi có quyết định sản phẩm.

## Quy ước đóng góp

- Không commit `.env`, secret, API key hoặc dữ liệu người dùng thật.
- Biến môi trường mới phải được thêm vào `.env.example` và schema kiểm tra backend.
- Thay đổi database phải có Prisma migration và kiểm thử PostgreSQL tương ứng.
- Luồng nghiệp vụ mới phải kiểm tra quyền ở backend, xử lý cạnh tranh và có regression test.
- Chuỗi giao diện/lỗi API mới phải qua quality gate i18n.
- Chạy `corepack pnpm check` trước khi merge.
- Chia commit theo một thay đổi logic để có thể review và rollback độc lập.
