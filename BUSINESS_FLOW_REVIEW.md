# Rà soát luồng nghiệp vụ Wind EDU

Phiên bản: 1.0 · Ngày: 2026-09-06 · Người lập: Wind Of Fall · Trạng thái: Rà soát tĩnh, chờ UAT.

## Phạm vi và cách đọc

Đối chiếu schema Prisma, controller, service, màn hình chính và các điểm kiểm thử hiện có trên working tree hiện tại. Không sửa mã sản phẩm, không chạy thao tác trên dữ liệu thật, không khẳng định đã tái hiện bằng trình duyệt. Kết quả kiểm thử xanh trước đây không chứng minh những luồng liên vai trò dưới đây đã đầy đủ.

Đã rà phạm vi: tài khoản/vai trò; khóa học/phiên bản; lớp/ghi danh/phân công; kho tài liệu; câu hỏi/AI; đề thi/lượt thi; bài tập/chấm; phúc khảo/kết quả; diễn đàn/kiểm duyệt; lịch/phòng học/điểm danh/bản ghi; hỗ trợ; thông báo; báo cáo/can thiệp; cấu hình/sao lưu/xuất dữ liệu/lưu trữ; dashboard/điều hướng/danh bạ/chat.

Phân loại: **Lỗi mã** = mâu thuẫn trực tiếp quan sát từ nguồn; **Thiếu luồng** = chưa thấy bước/API/UI cần để khép vòng; **Cần quyết định** = quy tắc chưa được chốt, không mặc định là lỗi. Mỗi mục có phạm vi bằng chứng riêng; đây không phải cam kết đã tìm hết lỗi toàn project.

P1: ưu tiên sửa trước vận hành luồng liên quan. P2: hoàn thiện sau các điểm chặn. Task tương ứng ở [CHECK_TASKS.md](CHECK_TASKS.md).

## Những phần đã có và nên giữ

- Xác minh email, MFA, quản lý phiên và kiểm tra trạng thái tài khoản đã có trong AuthService.
- Có bảo vệ tài khoản quản trị hoạt động cuối cùng trong IdentityService.
- Khóa học có phiên bản; câu hỏi sửa qua phiên bản mới; tạo đề thủ công kiểm tra câu hỏi đã xuất bản cùng môn.
- Lượt thi có cơ chế nộp một lần và đối soát lượt hết hạn. Bài có tự luận được chuyển chờ chấm.
- Bài tập có rubric, kiểm tra tổng điểm, quét tệp, đọc tệp theo quyền; bản mới đã xem được bài nộp.
- Lớp có readiness, điểm danh có khóa/giải quyết khiếu nại, bài thi có lịch sử điểm. Cần nối đầy đủ các cơ chế này.
- Báo cáo xuất CSV ở LearningService có luồng tệp riêng; không đồng nhất lỗi export quản trị với mọi chức năng xuất báo cáo.

## Phát hiện và tiêu chí nghiệm thu

### WF-01 — P1 — Chấm tự luận lần đầu bị hiểu là sửa điểm

**Lỗi mã.** `apps/api/src/learning/learning.service.ts:1505` lưu điểm trắc nghiệm tạm khi nộp đề hỗn hợp, kể cả 0. `gradeAttempt` tại dòng 1856 dùng `score !== null` để yêu cầu lý do sửa điểm. `apps/web/src/app/(workspace)/teaching-operations/page.tsx:358` chỉ hiện ô lý do khi status là GRADED. Bài SUBMITTED do đó có thể không chấm được qua form.

**Nghiệm thu:** bài chỉ tự luận và bài hỗn hợp chấm lần đầu được mà không nhập lý do sửa; lần chỉnh sau công bố bắt buộc lý do; tổng bằng điểm từng câu và lưu người chấm/thời điểm. Kiểm tra trạng thái lượt thi trước khi cho chấm.

### WF-02 — P1 — Phúc khảo chưa có đầu xử lý

**Thiếu luồng.** `learning.service.ts:1654` tạo yêu cầu và kết quả trả trạng thái. Tìm trong API/web chỉ thấy bước yêu cầu, kiểu dữ liệu và hiển thị; chưa thấy hàng đợi nhận/giải quyết phúc khảo. Comment nói thông báo giảng viên nhưng hàm chỉ tạo yêu cầu.

**Nghiệm thu:** gửi → thông báo người phụ trách → nhận xử lý → giữ/sửa điểm hoặc từ chối có lý do → thông báo học viên → kết thúc; lưu lịch sử, hạn 7 ngày và chống yêu cầu đang mở trùng. UI xử lý đúng cả hết hạn và yêu cầu đã kết thúc.

### WF-03 — P1 — Đóng lớp bỏ sót công việc học vụ

**Lỗi mã/thiếu luồng.** `learning.service.ts:455` kiểm tra đề mở, bài thi SUBMITTED, buổi học, điểm danh và khiếu nại điểm danh; không tính AssignmentSubmission, RegradeRequest, hoặc lượt IN_PROGRESS. Một lớp có thể đủ điều kiện theo bộ kiểm tra này trong khi bài tập chưa chấm/phúc khảo chưa giải quyết.

**Nghiệm thu:** màn hình readiness liệt kê tất cả công việc còn mở với đường dẫn xử lý; chỉ đóng khi trạng thái tương ứng đã hoàn tất; kiểm tra chốt và cập nhật lớp bảo vệ trước thay đổi đồng thời.

### WF-04 — P1 — Chỉ đọc của lớp đóng chưa xuyên suốt

**Lỗi mã.** `academic.service.ts:230` kiểm tra vai trò và quan hệ lớp nhưng không kiểm tra trạng thái lớp. Các thao tác tạo/xuất bản/chấm bài và thông báo dùng helper này. `submitAssignment:67` cũng không kiểm tra lớp CLOSED.

**Nghiệm thu:** lớp đóng vẫn đọc được hồ sơ theo quyền nhưng không phát sinh/chỉnh sửa hoạt động học vụ; thao tác điều chỉnh hậu kiểm phải có chính sách riêng và audit, không vô tình mở lại mọi thao tác.

### WF-05 — P1 — Cờ ghi danh muộn chưa có hiệu lực

**Lỗi mã.** `learning.service.ts:254` lưu allowLateEnrollment, giao diện lớp hiển thị cờ. `enrollLearner:346` chỉ kiểm tra lớp đóng, trùng và sĩ số, chưa áp dụng cờ/thời gian bắt đầu.

**Nghiệm thu:** cả ghi danh đơn và import tuân cùng quy tắc muộn; thời điểm tính muộn được chốt rõ; dòng từ chối giải thích lý do. Học viên vào muộn có chính sách bài cũ và hạn bù nhất quán.

### WF-06 — P1 — Thông báo làm hỏng thao tác lặp hợp lệ

**Lỗi mã.** `learning.service.ts:346` ghi danh lại qua upsert nhưng tạo notification với cùng dedupKey cho cặp lớp/học viên; schema Notification có unique dedupKey. `closeClass:482` tương tự dùng khóa cố định theo lớp/người nhận. Sau một chu kỳ gỡ/ghi danh hoặc đóng/mở lại, thông báo cũ có thể khiến transaction sau thất bại.

**Nghiệm thu:** hai chu kỳ liên tiếp thành công, lịch sử vẫn đủ, không spam; định danh thông báo theo sự kiện hoặc cập nhật đúng bản ghi hiện có.

### WF-07 — P1 — Sổ điểm trộn chưa chấm với điểm 0

**Lỗi mã/cần quyết định.** `academic.service.ts:169` lấy tổng điểm tối đa của mọi bài đã công bố, kể cả chưa đến hạn, nhưng tử số chỉ tính bài GRADED. Điểm thi lấy cao nhất mỗi đề và điểm bài tập cộng thẳng; chưa có trọng số hay trạng thái đủ dữ liệu.

**Nghiệm thu:** phân biệt chưa đến hạn, chưa nộp, chờ chấm, vắng/0 và đã chấm. Điểm tạm tính ghi rõ mẫu số; điểm chính thức theo cấu hình trọng số và quy tắc lần thi đã chốt. Ví dụ 8/10 ở bài đã chấm cùng một bài 10 điểm chưa đến hạn không được âm thầm hiển thị thành 40% chính thức.

### WF-08 — P1 — Báo cáo tiến độ không cùng cách tính với sổ điểm

**Lỗi mã/cần quyết định.** `learning.service.ts:3072` trung bình mọi lần thi trong kỳ, trong khi sổ điểm lấy lần cao nhất; điểm null thành 0; không tổng hợp bài tập. Truy cập tài liệu được coi là hoàn thành dù chưa chứng minh đã học xong.

**Nghiệm thu:** báo cáo, dashboard và kết quả dùng một chính sách điểm; không xếp học viên rủi ro vì giảng viên chưa chấm. Có chỉ số bài tập; đổi tên thành “đã truy cập” hoặc có quy tắc hoàn thành học liệu thật. Ví dụ thi 4 rồi 8 không cho hai nơi 60% và 80% dưới cùng tên chỉ số.

### WF-09 — P1 — Câu hỏi AI được xuất bản ngay

**Lỗi quy trình.** `learning.service.ts:1760` lưu câu AI với status PUBLISHED trong khi đề là DRAFT; không đi qua chế độ duyệt câu hỏi. Như vậy lời hứa “xem lại trước khi dùng” chưa áp dụng cho ngân hàng câu hỏi.

**Nghiệm thu:** AI sinh nháp; giảng viên sửa/duyệt nội dung rồi chuyển theo cấu hình phê duyệt; đề nháp được chứa câu nháp nhưng chỉ công bố khi mọi điều kiện đạt. Tái dùng câu cũ phải đối chiếu cả loại, đáp án và lựa chọn, không chỉ nội dung. Lưu nguồn gốc và phiên bản.

### WF-10 — P1 — Đề bị trả về thiếu bước sửa

**Thiếu luồng.** `content.controller.ts` có tạo đề, gửi duyệt và trả lại; chưa có API sửa đề nháp. Preview hiện dành cho giảng viên có quyền quản lý đề và được phân công; thiếu preview phù hợp người quản lý duyệt đề. `exams/page.tsx` có nút tạo/xem/gửi/duyệt, chưa có trình sửa cấu trúc đề nháp.

**Nghiệm thu:** nháp → xem/sửa câu, đáp án, cấu trúc, lịch → gửi → duyệt hoặc trả về kèm lý do → sửa → gửi lại; người duyệt xem được nội dung theo quyền. Đề đang có lượt thi không bị sửa nội dung đang dùng; sửa sau công bố cần phiên bản/quy tắc rõ.

### WF-11 — P2 — Mọi câu trong đề bị chia điểm đều

**Giới hạn nghiệp vụ.** `createExam:1320` và `createGeneratedExam:1760` lấy totalScore / số câu. Không cấu hình được tự luận nhiều điểm hơn trắc nghiệm.

**Nghiệm thu:** tổng điểm từng câu bằng điểm đề; hỗ trợ ma trận 4 câu trắc nghiệm × 1 + 1 tự luận × 6 = 10; giới hạn và làm tròn nhất quán khi chấm/xem kết quả.

### WF-12 — P2 — Kho theo môn mới ở cách nhóm giao diện

**Thiếu mô hình.** Prisma Material vẫn thuộc classId; `listMaterials:534` lọc theo quan hệ lớp. Trang materials nhóm lớp theo môn nhưng chưa tạo thư viện độc lập cấp môn, chưa có phân phối phiên bản dùng chung tới các lớp.

**Nghiệm thu:** xác định tài liệu thuộc môn hay riêng lớp; giảng viên được phân quyền tái dùng một tài liệu cho nhiều lớp mà không tải bản sao; lớp cũ giữ phiên bản đã sử dụng; tài liệu riêng lớp không bị chia sẻ ngoài ý muốn.

### WF-13 — P1 — Ngữ cảnh AI chưa đủ khả năng lựa chọn và truy vết

**Giới hạn/thiếu luồng.** `getExamGenerationContext:1692` chọn tài liệu theo mới cập nhật, lấy tối đa 12 ứng viên và 6 tệp, giới hạn kích thước; bỏ qua lỗi đọc. Người dùng chọn chế độ nhưng chưa chọn từng tệp/chương. Không đọc được tệp có thể bị hiểu như không có tài liệu để chuyển web. Danh sách nguồn chưa được lưu đầy đủ cùng đề để mở lại kiểm tra.

**Nghiệm thu:** hiển thị tệp được chọn/bị loại và lý do, chọn phạm vi; phân biệt môn trống, không hỗ trợ định dạng, lỗi storage và lỗi provider. AUTO chỉ fallback theo quy tắc rõ, có báo nguồn thực tế; lưu tệp/phiên bản/URL, cấu hình tạo và giới hạn; live test riêng trước khi tuyên bố chạy thật.

### WF-14 — P1 — Thông báo dẫn sai nơi hoặc mất ngữ cảnh

**Lỗi mã.** `workspace-shell.tsx:168` suy route từ chuỗi type: ASSIGNMENT_GRADED đi sang exams, ASSIGNMENT_PUBLISHED rơi về dashboard. Các route chỉ đến phân hệ không đến bài. `notifyClassMembers` trong LearningService gán entityType LIVE_SESSION cố định dù được dùng khi tạo chủ đề diễn đàn.

**Nghiệm thu:** ánh xạ type/entityType/entityId có hợp đồng chung; bấm thông báo mở đúng bài/lớp/chủ đề/phiếu và tab; đối tượng hết quyền/đã xóa có trạng thái rõ; đánh dấu đọc không làm mất khả năng xử lý.

### WF-15 — P1 — Lịch chưa lọc trạng thái theo người xem

**Lỗi mã.** `academic.service.ts:188` nạp sessions và exams không lọc status, rồi tạo sự kiện chung; học viên có thể thấy lịch đề nháp/chờ duyệt và lịch buổi đã hủy không được phân biệt. Href dẫn trang tổng quát.

**Nghiệm thu:** học viên chỉ thấy lịch đã công bố; hủy/đổi lịch thể hiện trạng thái; lịch giảng viên có thể thấy nháp với nhãn riêng; bấm sự kiện mở đúng đối tượng, giữ lớp và múi giờ.

### WF-16 — P1 — Cấp phòng Meet/Zoom chưa phải tích hợp thật

**Lỗi mô tả khả năng/thiếu tích hợp.** `learning.service.ts:3746` ghép URL provider với UUID; `provisionProviderMeeting:3757` lặp dựa trên danh sách lỗi mô phỏng, không gọi API tạo meeting hay dùng cấu hình IntegrationProvider. Không có bằng chứng URL Meet/Zoom tạo ra là phòng hợp lệ.

**Nghiệm thu:** provider bật và cấu hình hợp lệ mới được chọn; tạo phòng trả meeting ID/URL thật từ provider; thất bại/fallback thể hiện chính xác; giảng viên mở và học viên vào được trong kiểm thử tích hợp. Không báo đã cấp phòng dựa trên việc ghép chuỗi URL.

### WF-17 — P1 — Phút tham dự chưa phản ánh các lần vào/ra

**Lỗi mã.** `joinSession:2502` giữ joinedAt đầu tiên và đặt PRESENT khi bấm vào; `leaveSession:2538` lấy thời điểm hiện tại trừ joinedAt, không giới hạn trong cửa sổ buổi học, không trừ khoảng rời phòng. Hai hàm chưa dùng trạng thái khóa điểm danh để bảo vệ kết quả chốt.

**Nghiệm thu:** tổng phút là tổng các khoảng tham dự hợp lệ, không vượt thời lượng buổi; ngắt mạng/vào lại không tính khoảng vắng; mở link là sự kiện vào chứ chưa phải chứng minh có mặt; kết quả khóa chỉ đổi qua quy trình điều chỉnh có lý do.

### WF-18 — P1 — Phiếu hỗ trợ thiếu quy tắc bàn giao

**Lỗi mã/thiếu luồng.** `updateTicket:2989` kiểm tra tài khoản xử lý ACTIVE nhưng chưa kiểm tra vai trò xử lý, chưa có ma trận chuyển trạng thái. Người gửi chỉ được đóng sau RESOLVED, trong khi quản lý có thể đặt trạng thái tùy giá trị hợp lệ của DTO. `addTicketComment:3050` chưa phát thông báo cho bên nhận.

**Nghiệm thu:** OPEN → nhận việc → IN_PROGRESS → RESOLVED → người gửi xác nhận CLOSED; mở lại nếu cần theo quy tắc; assignee có quyền; phản hồi và đổi trạng thái có thông báo; SLA và người chịu trách nhiệm hiện rõ; phiếu trùng có hành động gộp/chuyển tham chiếu rõ.

### WF-19 — P1 — Xuất dữ liệu quản trị báo hoàn tất trước khi có tệp

**Lỗi mã.** `system.service.ts:415` đếm dòng, tạo DataExportJob COMPLETED và objectKey; không ghi nội dung tệp. `system.controller.ts` có tạo/liệt kê export, chưa thấy đường tải tệp cho luồng này.

**Nghiệm thu:** yêu cầu → tạo tệp thực → xác minh số dòng/checksum → COMPLETED → tải có quyền/hạn dùng; lỗi sinh tệp là FAILED. Không áp dụng kết luận này cho export CSV báo cáo học tập vốn có implementation khác.

### WF-20 — P1 — Khôi phục và phê duyệt chưa đúng ý nghĩa giao diện

**Mâu thuẫn luồng.** `system.service.ts:282` thực hiện verifyRestore vào DB tạm rồi dọn; đây là kiểm tra phục hồi, không phục hồi DB vận hành. Form `admin/operations/page.tsx:207` truyền tên người đang thao tác làm approvedBy; đó không phải quyết định từ người thứ hai đã xác thực.

**Nghiệm thu:** đặt tên riêng “Kiểm tra bản sao lưu”; khôi phục vận hành là luồng khác với điểm khôi phục, kiểm tra, kế hoạch và trạng thái. Nếu cần hai người duyệt, lưu yêu cầu và quyết định từ hai phiên/người đủ quyền; không nhập tên thay chữ ký phê duyệt. Không thực hiện restore thật trong lượt audit.

### WF-21 — P1 — Archive chưa đủ để phục hồi học liệu

**Lỗi bảo toàn dữ liệu.** `system.service.ts:754` archive LEARNING thành JSON chứa metadata, sau đó xóa lớp và xóa object học liệu. Snapshot assignments chỉ include submissions, không include attachments; danh sách objectKeys chỉ lấy học liệu, chưa lấy tệp bài nộp. Vì vậy dữ liệu archive chưa bảo đảm phục hồi file và còn nguy cơ object bài nộp mồ côi.

**Nghiệm thu:** archive đóng gói hoặc tham chiếu bền vững đầy đủ tệp/phiên bản cùng metadata, checksum; kiểm tra khôi phục đọc được cả học liệu và bài nộp trước khi dọn nguồn; phân biệt ARCHIVE và DELETE; xử lý lại an toàn khi lỗi từng bước. Chưa chạy retention trên dữ liệu thật để kiểm chứng.

### WF-22 — P1 — Đổi vai trò/khóa người dùng chưa bàn giao lớp

**Thiếu luồng.** `identity.service.ts:113` đổi vai trò/trạng thái và bảo vệ admin cuối, nhưng chưa kiểm tra/bàn giao lớp ACTIVE, buổi sắp dạy, bài chờ chấm hoặc phiếu đang xử lý. Khóa giảng viên chính có thể để lớp vẫn có phân công nhưng không còn người thực hiện.

**Nghiệm thu:** xem trước ảnh hưởng; chặn hoặc bàn giao cho người hợp lệ theo chính sách; lưu lịch sử người cũ, không mất bài làm/điểm; trường hợp khóa khẩn cấp tạo việc cần bàn giao cho quản lý. Kiểm tra riêng mô hình đa vai trò vì sửa hiện tại xóa các vai trò cũ khi thay vai trò chính.

### WF-23 — P1 — Phạm vi và quyền theo thao tác chưa đồng nhất

**Mâu thuẫn nghiệp vụ cần chuẩn hóa.** Một số API báo cáo nhận quyền xem chung nhưng chưa truyền actor xuống service để lọc lớp; ngân hàng câu hỏi chưa thể hiện rõ sở hữu/chia sẻ theo giảng viên. Ngược lại, gradebook qua route quyền report:view nhưng helper học thuật chỉ cho INSTRUCTOR và exam:manage, nên quản lý có quyền báo cáo vẫn không xem sổ điểm qua luồng đó.

**Nghiệm thu:** ma trận vai trò × thao tác × quan hệ lớp thống nhất; quyền đọc không mặc nhiên là quyền tạo can thiệp/sửa dữ liệu; quản lý xem được theo phạm vi nhưng không chấm nếu không được phép. Kiểm chứng bằng test quyền nội bộ trên dữ liệu giả, không thử truy cập dữ liệu người khác. Tách quyền xem lớp/hồ sơ khỏi quyền sửa để không dùng helper ghi cho thao tác đọc.

### WF-24 — P2 — Sửa diễn đàn chưa đồng bộ trạng thái lớp

**Thiếu quy tắc.** `learning.service.ts:2123` và `deletePost:2143` kiểm tra tác giả, trạng thái bài và topic khóa; chưa kiểm tra lại thành viên lớp/trạng thái CLOSED giống lúc tạo. Sửa bài chưa gọi lại chính sách kiểm duyệt như khi tạo.

**Nghiệm thu:** chốt quyền chỉnh sửa sau rời/đóng lớp; mọi thao tác tuân cùng quy tắc; sửa nội dung vẫn áp dụng kiểm duyệt và lịch sử; bản ẩn có lý do và luồng khiếu nại rõ. Không để chat mới lặp lại sự không đồng nhất này.

### WF-25 — P2 — Dashboard và danh bạ chưa phản ánh đủ công việc

**Lỗi trải nghiệm/thiếu luồng.** `dashboard-home.tsx:47` đếm bài chờ chấm và kết quả qua exam, không tính assignment nhưng nhãn dùng “bài”. Chi tiết lớp chỉ tải roster tên đầy đủ khi canManage; người học/giảng viên có nhánh hiển thị ID. Điều hướng có nhiều điểm vào chồng nhiệm vụ.

**Nghiệm thu:** KPI có định nghĩa rõ và khớp hàng đợi; cả bài tập và đề thi được tính; thành viên hiển thị tên/role/lớp chung theo quyền, có nút liên hệ; dashboard dẫn tới công việc cụ thể. Giảm màn hình trùng mà không mất chức năng.

### WF-26 — P2 — Bài tập thiếu chỉnh sửa và lịch sử đánh giá

**Thiếu luồng.** `academic.controller.ts` có tạo/xuất bản/nộp/chấm, chưa có sửa/gia hạn/đóng bài. `submitAssignment:67` upsert nội dung hiện tại; `gradeSubmission:148` ghi đè điểm và phản hồi, công bố ngay, chưa có lịch sử sửa điểm/lý do tương đương bài thi.

**Nghiệm thu:** sửa bản nháp; sửa yêu cầu sau công bố theo phiên bản và thông báo; gia hạn toàn lớp hoặc cá nhân có lý do; nộp lại có biên nhận và bản chốt; giảng viên chấm đúng phiên bản; sửa điểm lưu trước/sau/người/lý do. Chọn chính sách nháp điểm/công bố tách biệt khi triển khai.

## Ma trận UAT liên vai trò cần chạy

| ID | Luồng | Kết quả kiểm chứng bắt buộc |
|---|---|---|
| UAT-01 | Đăng ký → xác minh → ghi danh → học viên vào lớp | Tài khoản mới có bước tiếp theo rõ, tên người đúng, quyền khớp ghi danh |
| UAT-02 | Tạo khóa/phiên bản → lớp → phân công → kích hoạt → đổi giảng viên | Không lớp hoạt động thiếu người chịu trách nhiệm; lịch/bài được bàn giao |
| UAT-03 | Ghi danh muộn → gỡ → ghi danh lại | Cờ muộn có hiệu lực, sức chứa đúng, thông báo không phá transaction |
| UAT-04 | Upload tài liệu → chia sẻ môn/lớp → thay phiên bản → lưu trữ | Người đúng quyền đọc đúng phiên bản và khôi phục đủ tệp |
| UAT-05 | Tạo AI/thủ công → sửa → duyệt/trả → sửa → công bố | Không xuất bản câu nháp ngoài quy trình; nguồn/điểm/cấu trúc đúng |
| UAT-06 | Thi → mất mạng → hết giờ → nộp → chấm tự luận lần đầu | Không mất/trùng bài, không bắt lý do sửa ở lần đầu |
| UAT-07 | Công bố điểm → phúc khảo → sửa điểm → đóng yêu cầu | Hai vai trò nhận đúng thông báo, lịch sử và trạng thái kết thúc |
| UAT-08 | Bài tập → nộp/nộp lại → chấm → sửa điểm → gia hạn | Phiên bản bài, tệp, rubric, hạn và lịch sử nhất quán |
| UAT-09 | Tạo phòng → vào/ra/vào lại → khóa điểm danh → khiếu nại | URL phòng thật, phút hợp lệ, kết quả khóa không đổi ngoài luồng |
| UAT-10 | Đăng/sửa chủ đề → khóa/ẩn → báo cáo → giải quyết | Quyền lớp và chính sách kiểm duyệt xuyên suốt |
| UAT-11 | Tạo phiếu → phân công → trao đổi → giải quyết → xác nhận | Người xử lý hợp lệ, chuyển trạng thái đúng, bên kia được thông báo |
| UAT-12 | Điểm/hoạt động → báo cáo → can thiệp → hoàn thành | Chỉ số thống nhất, không coi chờ chấm là yếu, công việc có chủ |
| UAT-13 | Đóng lớp → tra cứu → mở lại → đóng lại | Không bỏ sót bài/phúc khảo, giữ dữ liệu, sự kiện lặp không lỗi |
| UAT-14 | Export → tải → sao lưu → kiểm tra phục hồi → archive | Có tệp thực và đọc được; trạng thái phản ánh kết quả, không chỉ job |
| UAT-15 | Thu hồi vai trò/khóa → phiên đang mở → bàn giao | Quyền mới có hiệu lực, lớp và công việc không mồ côi |
| UAT-16 | Danh bạ → chat → gỡ thành viên → khóa lớp | Thực hiện sau khi xây chat; quyền, tệp, realtime và unread nhất quán |

Hiện tất cả UAT ở trạng thái **chưa chạy trong lượt rà soát này**. Kiểm tra cạnh đồng thời/mất mạng và live provider theo VERIFY trong checklist. Không đánh dấu phát hiện là đã sửa chỉ vì đã ghi tài liệu.
