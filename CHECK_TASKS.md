# Checklist nghiệp vụ Wind EDU

Phiên bản: 1.6 · Ngày: 2026-09-06 · Người lập: Wind Of Fall · Trạng thái: Toàn bộ phạm vi triển khai, song ngữ Việt–Anh và chiến dịch nghiệm thu nội bộ đã hoàn tất; còn ba nhóm phụ thuộc quyết định/credential bên ngoài tại K.2.

Phạm vi: toàn bộ project, bốn vai trò SYSTEM_ADMIN, CENTER_MANAGER, INSTRUCTOR, LEARNER.
Nguồn quyết định: người dùng đã đồng ý phương án lấy lớp làm trung tâm, danh bạ theo lớp, chat theo ngữ cảnh và thống nhất chấm bài; yêu cầu ghi task và rà toàn bộ nghiệp vụ.

## Quy tắc theo dõi

- `[x]` chỉ là đã hoàn thành đúng nội dung dòng đó; việc duyệt phương án không có nghĩa đã triển khai.
- P1/Must: luồng bị chặn, kết quả sai hoặc khả năng vận hành chưa đúng. P2/Should: hoàn thiện trải nghiệm và quy tắc. P3/Could: mở rộng sau.
- WF-01…26 liên kết bằng chứng trong [báo cáo vòng 1](BUSINESS_FLOW_REVIEW.md); WF-27…38 có bằng chứng và phương án triển khai ngay tại mục H của file này.
- Chỉ đánh dấu task triển khai xong sau khi kiểm tra cả giao diện, API, dữ liệu và kết quả phía vai trò nhận bàn giao.
- Task đã có mã nhưng chưa đạt đủ nghiệm thu vẫn giữ `[ ]`; tiến độ triển khai, bằng chứng và phần còn thiếu được ghi tại mục K, không đổi thành Done chỉ vì test tự động xanh.

## A. Quyết định và thiết kế đã thống nhất

- [x] DEC-01: Dùng lớp học làm điểm vào chính cho học liệu, bài tập, kết quả, thành viên và trao đổi.
- [x] DEC-02: Ba điểm vào chat: thành viên lớp, ngữ cảnh bài học/bài làm, trang Tin nhắn.
- [x] DEC-03: Một hội thoại riêng cho mỗi cặp người dùng; nội dung liên quan bài được đính kèm dưới dạng thẻ ngữ cảnh.
- [x] DEC-04: Phân biệt chat riêng, chat lớp, diễn đàn, thông báo và phiếu hỗ trợ.
- [x] DEC-05: Chat lớp tự đồng bộ thành viên, lớp đóng chuyển nhóm sang chỉ đọc.
- [x] DEC-06: Gom chấm bài tập và bài thi vào cùng điểm vào; giữ cách chấm riêng theo loại bài.
- [x] DEC-07: Giữ nhận diện hiện tại; ưu tiên cấu trúc thông tin, việc cần làm và liên kết đúng đối tượng.
- [x] REV-01: Hoàn thành rà soát tĩnh các phân hệ chính; phạm vi và giới hạn ghi trong BUSINESS_FLOW_REVIEW.md.
- [x] REV-02 — P1/Must: Kiểm chứng các WF bằng UAT trên dữ liệu thử độc lập; ghi kết quả, không dùng dữ liệu học tập đang vận hành.

## B. Luồng chat và không gian lớp

- [x] CHAT-01 — P1/Must: Danh bạ theo lớp cho bốn vai trò. Học viên tìm giảng viên/bạn cùng lớp bằng tên có hoặc không dấu, mã công khai; thấy vai trò và lớp chung; không lộ dữ liệu quản trị.
- [x] CHAT-02 — P1/Must: Chat riêng từ thành viên, bài tập, kết quả và Tin nhắn. Nghiệm thu: từ danh sách thành viên mở đúng người trong tối đa hai thao tác; nhấn nhiều lần không tạo hội thoại trùng; không tự gửi nội dung.
- [x] CHAT-03 — P1/Must: Chat lớp đồng bộ ghi danh/phân công; người bị gỡ ngừng nhận tin mới; lớp đóng chỉ đọc; kiểm tra quyền cả lịch sử, tệp và sự kiện realtime.
- [x] CHAT-04 — P1/Must: Gửi văn bản/tệp, trả lời một tin, trạng thái gửi, thử lại chống trùng, phân trang lịch sử, bộ đếm chưa đọc đồng bộ nhiều thiết bị.
- [x] CHAT-05 — P2/Should: Tìm trong hội thoại, tắt thông báo, nhắc tên, báo cáo/chặn; không gửi popup khi đang đọc chính hội thoại đó.
- [x] CHAT-06 — P2/Should: Giao diện desktop hai cột, mobile danh sách → hội thoại; giữ bản nháp, bàn phím không che ô nhập, khôi phục vị trí đọc.
- [x] CHAT-07 — P2/Should: Đính kèm thẻ bài/tệp đúng ngữ cảnh; người nhận vẫn cần quyền xem đối tượng; thu hồi quyền không để nội dung cũ trong thẻ tiếp tục lộ ra.
- [x] UX-01 — P1/Must: Không gian lớp có tổng quan, học tập, đánh giá, thành viên, trao đổi; đường dẫn sâu giữ classId và đối tượng đang xem.
- [x] UX-02 — P1/Must: Một hàng đợi Chấm bài cho bài tập và bài thi; nhóm lớp → bài → bài nộp; mở bài và rubric cạnh nhau; chuyển bài tiếp theo giữ bộ lọc.
- [x] UX-03 — P2/Should: Dashboard theo việc cần làm của từng vai trò, tính cả bài tập và bài thi; xem WF-25.
- [x] UX-04 — P2/Should: Thống nhất lịch, kết quả và thông báo với trạng thái nghiệp vụ; xem WF-07, WF-08, WF-14, WF-15.
- [ ] CHAT-08 — P3/Could: Liên hệ ngoài lớp bằng yêu cầu được chấp nhận; nhóm tự tạo chỉ triển khai sau khi xác định nhu cầu. Gọi video không thuộc bản chat đầu.

## C. Các task phát hiện trong rà soát

- [x] WF-01 — P1/Must: Sửa phân biệt chấm tự luận lần đầu và sửa điểm đã công bố.
- [x] WF-02 — P1/Must: Hoàn thành phúc khảo: hàng đợi, nhận xử lý, quyết định, cập nhật điểm/lịch sử, thông báo và kết thúc.
- [x] WF-03 — P1/Must: Điều kiện đóng lớp tính cả bài tập, phúc khảo và lượt thi đang làm.
- [x] WF-04 — P1/Must: Áp dụng chỉ đọc của lớp đóng nhất quán lên bài tập, bài nộp và thông báo lớp.
- [x] WF-05 — P1/Must: Thực thi quy tắc ghi danh muộn đã cấu hình.
- [x] WF-06 — P1/Must: Gỡ rồi ghi danh lại, đóng rồi mở rồi đóng lớp không thất bại vì thông báo trùng.
- [x] WF-07 — P1/Must: Tách chưa đến hạn/chưa nộp/chờ chấm/đã chấm khỏi điểm 0 và quy định điểm tổng hợp.
- [x] WF-08 — P1/Must: Thống nhất báo cáo tiến độ với sổ điểm, chính sách nhiều lần thi và dữ liệu bài tập.
- [x] WF-09 — P1/Must: Câu hỏi AI tuân thủ vòng đời duyệt câu hỏi và giữ nguồn gốc.
- [x] WF-10 — P1/Must: Bổ sung sửa đề nháp/trả về, chỉnh câu hỏi/thời gian, xem đề theo quyền người duyệt.
- [x] WF-11 — P2/Should: Cho cấu hình điểm từng câu thay vì chia đều mọi loại câu.
- [x] WF-12 — P2/Should: Hoàn thiện sở hữu và chia sẻ tài liệu theo môn học ở tầng dữ liệu.
- [x] WF-13 — P1/Must: AI cho chọn tài liệu/phạm vi, phân biệt không có tệp với lỗi đọc, lưu danh sách nguồn sử dụng.
- [x] WF-14 — P1/Must: Thông báo dẫn đúng đối tượng, đúng loại và đúng quyền; chuẩn hóa entityType.
- [x] WF-15 — P1/Must: Lịch chỉ hiện hoạt động hợp lệ cho vai trò, trạng thái và có liên kết sâu.
- [x] WF-16 — P1/Must: Tạo phòng online thật hoặc hiển thị rõ chế độ chưa tích hợp; đồng bộ cấu hình provider.
- [x] WF-17 — P1/Must: Điểm danh theo các khoảng tham dự, giới hạn thời lượng, tuân thủ khóa điểm danh.
- [x] WF-18 — P1/Must: Phiếu hỗ trợ có chuyển trạng thái hợp lệ, người xử lý đúng vai trò và thông báo phản hồi.
- [x] WF-19 — P1/Must: Xuất dữ liệu quản trị tạo tệp thực, tải được rồi mới hoàn tất.
- [x] WF-20 — P1/Must: Phân biệt kiểm tra bản sao lưu và khôi phục vận hành; xác thực quyết định phê duyệt.
- [x] WF-21 — P1/Must: Lưu trữ dữ liệu học tập bảo toàn tệp học liệu và tệp bài nộp, có kiểm tra phục hồi.
- [x] WF-22 — P1/Must: Thay đổi vai trò/khóa tài khoản có bước xử lý công việc và lớp đang phụ trách.
- [x] WF-23 — P1/Must: Chuẩn hóa phạm vi theo lớp và quyền theo thao tác giữa các phân hệ.
- [x] WF-24 — P2/Should: Chính sách sửa/xóa bài diễn đàn sau khi rời lớp, khóa lớp và kiểm duyệt lại nhất quán.
- [x] WF-25 — P2/Should: KPI và danh bạ hiển thị đủ nhiệm vụ, tên người và quyền thực tế.
- [x] WF-26 — P2/Should: Bổ sung sửa/gia hạn/đóng bài tập, lịch sử nộp lại và lịch sử sửa điểm.

## D. Kiểm chứng bổ sung trước khi triển khai thật

Các mục này là rủi ro cần kiểm thử, chưa kết luận lỗi đã tái hiện.

- [x] VERIFY-01 — P1/Must: Hai người đồng thời ghi danh vào chỗ cuối không vượt sức chứa.
- [x] VERIFY-02 — P1/Must: Đóng lớp đồng thời với tạo bài/lịch/nộp bài không vi phạm trạng thái chốt.
- [x] VERIFY-03 — P1/Must: Nộp lại đồng thời với chấm không ghi đè điểm hoặc phiên bản bài đang chấm.
- [x] VERIFY-04 — P1/Must: Mất kết nối lúc lưu đáp án/nộp bài, hết giờ, tải lại trang không mất bài; dùng biên nhận từ máy chủ.
- [x] VERIFY-05 — P1/Must: Xóa tệp gặp lỗi DB/storage không để metadata trỏ tới tệp mất; có phục hồi và retry.
- [x] VERIFY-06 — P1/Must: Đổi vai trò/thu hồi quyền có hiệu lực trên phiên đang mở; người dùng thấy lý do và hành động tiếp theo.
- [x] VERIFY-07 — P2/Should: Kiểm tra dữ liệu rỗng, nhiều lớp, nhiều lần thi, dữ liệu cũ, ngày giờ/múi giờ, mobile và bàn phím.
- [ ] VERIFY-08 — P1/Must: Tạo đề AI live với provider đã cấu hình; kiểm tra số câu, chất lượng đáp án, nguồn, lỗi thời gian chờ, không tạo trùng khi thử lại.

## E. Thứ tự triển khai

1. Sửa lỗi chặn/sai kết quả: WF-01, 02, 03, 04, 06, 07, 08, 14; rà WF-21 trước mọi thao tác lưu trữ dữ liệu thật.
2. Hoàn chỉnh đánh giá và AI: WF-09, 10, 11, 13, 26.
3. Không gian lớp và danh bạ: UX-01, WF-05, 12, 22, 23, 25, CHAT-01.
4. Chat riêng/chat lớp: CHAT-02 đến CHAT-07; kiểm thử quyền và trạng thái thành viên trước realtime.
5. Luồng vận hành: WF-15 đến WF-20, WF-24; hoàn thiện UX-02 đến UX-04.
6. Chạy UAT liên vai trò theo VERIFY và báo cáo, sau đó mới đánh dấu hoàn thành.

## F. Quyết định nghiệp vụ cần chốt khi thiết kế chi tiết

- Chính sách lấy điểm khi thi nhiều lần: cao nhất, cuối cùng hay quy tắc từng đề; trọng số bài tập/thi.
- Có lưu nháp điểm và công bố theo bài/lớp hay công bố ngay; thời hạn và người giải quyết phúc khảo.
- Ghi danh muộn tính từ ngày bắt đầu hay thời điểm kích hoạt; quyền học bù/nộp bù của học viên vào muộn.
- Rời lớp giữ quyền đọc lịch sử chat cá nhân/nhóm đến đâu; giữ hồ sơ học tập theo chính sách nào.
- Phạm vi dùng chung ngân hàng câu hỏi/tài liệu giữa giảng viên; tài liệu riêng và tài liệu cấp môn.
- Quản lý được xem sổ điểm nhưng không sửa điểm; thay người phụ trách cần bàn giao những dữ liệu nào.

Những mục này không chặn việc ghi nhận lỗi hiện tại; không được tự coi giả định là quy tắc đã phê duyệt.

## G. Rà soát vòng 2 — phạm vi, kết quả và giới hạn

- [x] REV-03: Hoàn thành đối chiếu bổ sung mã nguồn, controller, schema, giao diện liên quan và cấu trúc test; bổ sung 12 phát hiện WF-27…38, không thay thế hay đánh dấu hoàn tất task cũ.
- Đầu ra theo yêu cầu mới: cập nhật `CHECK_TASKS.md` và đồng bộ trạng thái triển khai sang Google Sheets “check task” sau khi kiểm tra mã nguồn.
- Mục tiêu: tìm các bước nghiệp vụ bị đứt ở ranh giới phiên bản, phê duyệt, bàn giao, lỗi một phần và quyền truy cập; mỗi phát hiện có kết quả nghiệm thu quan sát được.
- Bằng chứng là working tree hiện tại, bao gồm thay đổi chưa commit của người dùng. Số dòng là vị trí lúc rà soát; tên hàm là điểm tra cứu ổn định hơn khi code thay đổi.
- Các giới hạn “không sửa/migrate/UAT” dưới G là điều kiện của lần rà soát phát hiện ban đầu, không phải trạng thái hiện tại sau triển khai.
- Trạng thái nghiệm thu hiện tại, database thử, lệnh kiểm tra và các phụ thuộc còn mở được chốt tại mục K; mục G.1 giữ nguyên làm dấu vết nguyên nhân tạo task.

### G.1. Phạm vi đối chiếu liên phân hệ

| Phân hệ | Kết quả đối chiếu vòng 2 | Theo dõi |
|---|---|---|
| Đăng ký, xác minh, khôi phục mật khẩu, phiên và vai trò | Có kích hoạt có điều kiện và kiểm tra trạng thái/quyền khi resolve phiên; không kết luận lại là chưa có xác thực. Bàn giao khi đổi vai trò vẫn là task cũ. | WF-22/23, VERIFY-06 |
| Khóa học, phiên bản, lớp, ghi danh và phân công | Có snapshot khóa học nhưng nơi tiêu thụ còn lấy bản hiện tại; điều kiện giảng viên chính chưa xuyên suốt. | WF-34/35; WF-05/06 cũ |
| Học liệu, phiên bản và kiểm duyệt | Đường tải bản hiện tại có kiểm tra cách ly; đường phiên bản chưa áp dụng cùng trạng thái thu hồi. | WF-27; WF-12/21 cũ |
| Ngân hàng câu hỏi, AI, đề và lượt thi | Văn bản câu hỏi tạo phiên bản mới; ảnh vẫn sửa tại chỗ. Đối chiếu lại cổng công bố và thời gian. | WF-28/36; WF-01/09/10/11/13 cũ |
| Bài tập, rubric, điểm, phúc khảo và báo cáo | Giữ các gap vòng 1; bổ sung cổng thời gian công bố và kết thúc hành động hỗ trợ học tập. | WF-36/38; WF-02/07/08/26 cũ |
| Diễn đàn và kiểm duyệt | Chuyển cấp, nhận kháng nghị và quyết định phục hồi nội dung chưa khép kín. | WF-31; WF-24 cũ |
| Buổi học, điểm danh và bản ghi | Đã có endpoint cấp quyền xem bản ghi nhưng API danh sách vẫn trả URL nguồn. | WF-37; WF-16/17 cũ |
| Phiếu hỗ trợ và bằng chứng | Có lưu bytes tệp; thiếu đọc/tải, và UI chưa xử lý tạo phiếu thành công nhưng upload thất bại. | WF-29/30; WF-18 cũ |
| Cấu hình, notification template, audit, backup và retention | Gửi email thử có gọi dịch vụ, không quy kết là giả lập; restore drill không phải restore vận hành. Bổ sung lỗi policy và thiếu kết thúc legal hold. | WF-32/33; WF-19/20/21 cũ |
| Điều hướng, dashboard, chat | Giữ UX-01…04 và CHAT-01…08; vòng này không thiết kế lại nhận diện hay kiểm tra pixel/mobile trực tiếp. | Các task UX/CHAT hiện có |

### G.2. Đối soát để không tạo task trùng hoặc kết luận sai

- Câu `SHORT_ANSWER` và `ESSAY` đã được `submitAttempt` chuyển sang chờ chấm thủ công (`learning.service.ts:1521`, `:1557`). Không thêm lỗi “trả lời ngắn thiếu đáp án nên tự chấm 0”. WF-01 về chấm lần đầu vẫn cần xử lý riêng.
- Mở rộng WF-06 khi triển khai: `assignInstructor:303` và `removeInstructor:334` cũng dùng dedupKey cố định; kiểm thử cả chu kỳ gỡ/gán lại giảng viên, không chỉ học viên/đóng lớp.
- Mở rộng WF-04: kiểm tra cả gỡ phân công, duyệt học liệu, gửi/duyệt đề sau khi lớp đóng; không chỉ AcademicService.
- WF-23 tiếp tục quản lý ma trận quyền dùng chung. WF-37 ghi riêng một hợp đồng trả dữ liệu bản ghi có bằng chứng cụ thể, không phải một đợt audit bảo mật toàn hệ thống.
- WF-38 không lặp WF-08: WF-08 sửa phép tính chỉ số; WF-38 khép kín công việc phát sinh sau khi phát hiện học viên cần hỗ trợ.
- Khôi phục DB vận hành, liên hệ ngoài lớp và gọi video vẫn không tự trở thành phạm vi được duyệt chỉ vì được ghi trong checklist.

## H. Phát hiện mới và phương án triển khai

Trạng thái chi tiết của các mục dưới đây được cập nhật tại mục K. Các mục chưa có trong nhật ký vẫn là **Backlog, chưa sửa**; bằng chứng UAT/MySQL độc lập chưa hoàn tất.

### WF-27 — Thu hồi học liệu chưa chặn đường phiên bản cũ

- [x] WF-27 — P1/Must: Thống nhất quyền xem/tải bản hiện tại và bản lịch sử khi ẩn hoặc cách ly học liệu.
- **Bằng chứng:** `apps/api/src/learning/learning.service.ts:813`, `:829`, `:849` chỉ kiểm tra quan hệ lớp và visibility của từng version; không kiểm tra `material.quarantinedAt` hay trạng thái thu hồi ở học liệu cha. `reviewClassMaterial:910` tạo version HIDDEN mới nhưng bản PUBLISHED cũ vẫn còn. Khác với `createMaterialAccess/readMaterialDownload`, đường version thiếu cổng cách ly.
- **Ảnh hưởng:** người học có thể vẫn yêu cầu đường tải version cũ sau khi quản lý ẩn học liệu. Cách ly/thu hồi không có cùng hiệu lực trên mọi đường truy cập.
- **Triển khai:** BE/Data tách “bản mới đang soạn” khỏi “thu hồi truy cập”; thêm trạng thái chặn có phạm vi rõ trên tài liệu/asset/version. Dùng một hàm xét quyền ở list, cấp link và tải bytes; recheck trước khi stream. FE hiển thị lý do thu hồi thay vì giữ nút tải khả dụng.
- **Nghiệm thu:** Given version cũ từng được phát hành, When bị thu hồi toàn tài liệu, Then link cũ lẫn yêu cầu cấp link mới đều bị chặn theo quyền. Given chỉ đang soạn version mới, Then version đã công bố vẫn đọc được nếu chưa thu hồi. Kiểm thử lại sau gỡ thành viên và với tệp được nhiều version tham chiếu.
- **Phụ thuộc/quyết định:** WF-12/23; chốt ẩn bản hiện tại khác thu hồi toàn tài liệu thế nào. Không xóa file để thay cho kiểm soát quyền.

### WF-28 — Ảnh câu hỏi phá tính bất biến của phiên bản đề

- [x] WF-28 — P1/Must: Đưa thêm/gỡ/thay ảnh vào cùng cơ chế phiên bản câu hỏi.
- **Bằng chứng:** `learning.service.ts:1005` tạo question mới khi sửa nội dung, nhưng `uploadQuestionImage:1046` và `removeQuestionImage:1077` cập nhật trực tiếp question theo ID, không chặn PUBLISHED hoặc câu đã gắn vào đề. `getExamQuestions:1255` đọc question được tham chiếu, không có snapshot ảnh riêng cho lượt thi.
- **Ảnh hưởng:** đề đang mở và bài đã nộp có thể hiển thị hình khác hình người học đã dùng để trả lời; lịch sử không đủ để giải quyết phúc khảo.
- **Triển khai:** BE dùng cùng lệnh tạo draft version cho văn bản và ảnh; dữ liệu đề ghim question version và asset checksum. Không dọn object khi còn đề/lượt thi/version tham chiếu. FE báo “Tạo phiên bản mới”, không mô tả là thay ảnh ngay trong đề đã phát hành.
- **Nghiệm thu:** Given v1 đã được dùng để thi, When thay/gỡ ảnh, Then tạo v2 nháp, v1 và bài làm cũ giữ ảnh/checksum ban đầu. Xuất bản v2 không tự đổi đề cũ; lỗi storage/DB không làm mất asset đang dùng.
- **Phụ thuộc:** WF-09/10/23, VERIFY-05; kiểm thử ở cả nhánh có Prisma và bộ nhớ.

### WF-29 — Tệp bằng chứng hỗ trợ chưa có đường đọc

- [x] WF-29 — P1/Must: Cho người gửi và nhân sự hỗ trợ có quyền mở/tải bằng chứng của ticket.
- **Bằng chứng:** `learning.service.ts:2951` đã lưu bytes vào storage và metadata `SupportAttachment`. Controller có POST upload nhưng chưa tìm thấy endpoint đọc/tải SupportAttachment trong `apps/api/src`; `apps/web/src/app/(workspace)/support/page.tsx:187` chỉ hiển thị tên/kích thước trong thẻ `span`.
- **Ảnh hưởng:** người xử lý biết có bằng chứng nhưng không xem được nội dung để chẩn đoán.
- **Triển khai:** BE thêm endpoint theo attachmentId, truy ngược ticket để kiểm tra người gửi/phạm vi nhân sự, checksum và trạng thái tệp; stream hoặc cấp URL ngắn hạn. FE có xem/tải, trạng thái tải lỗi và thông báo tệp không còn khả dụng. Dùng hạ tầng storage/quét tệp hiện có, không tạo kho public riêng.
- **Nghiệm thu:** Given ticket có PDF/ảnh, When người gửi hoặc người xử lý hợp lệ mở, Then đọc đúng bytes và tên file; người ngoài không lấy được nội dung bằng ID/link. Ticket đóng vẫn tra cứu bằng chứng theo chính sách lưu hồ sơ; không tự cho phép thêm/sửa tệp vào ticket đóng.
- **Phụ thuộc:** WF-18/23; tích hợp archive/retention bằng chứng với WF-21, tránh object mồ côi.

### WF-30 — Upload bằng chứng lỗi có thể tạo ticket lặp

- [x] WF-30 — P1/Must: Xử lý rõ thành công một phần của thao tác gửi phiếu hỗ trợ.
- **Bằng chứng:** `support/page.tsx:57` gọi tạo ticket rồi mới upload; chỉ đóng/reset/reload form sau cả hai bước. Nếu upload lỗi, catch báo lỗi chung và không giữ ticketId để retry. `createTicket` tại `learning.service.ts:2892` vẫn tạo row mới khi phát hiện trùng, chỉ gắn `duplicateOfId`.
- **Ảnh hưởng:** người dùng nhấn gửi lại có thể tạo thêm phiếu, dù yêu cầu ban đầu đã tồn tại; các phiếu trùng vẫn có SLA riêng.
- **Triển khai:** BE có khóa idempotency cho lệnh tạo phiếu; FE lưu kết quả tạo trước khi upload, báo “Phiếu đã tạo, tệp chưa gửi”, cho retry riêng tệp vào đúng phiếu. Khóa nút trong lúc request chạy; quản lý được xử lý quan hệ phiếu trùng, không âm thầm xóa lịch sử.
- **Nghiệm thu:** Given POST tạo thành công nhưng upload timeout, When thử lại, Then vẫn một ticket và một bản tệp hợp lệ. Given timeout sau server commit hoặc double-click, Then nhận lại cùng biên nhận; nội dung khác dùng khóa mới.
- **Phụ thuộc:** WF-18/29; đây là lỗi phối hợp nhiều bước, không chỉ bổ sung spinner.

### WF-31 — Chuyển cấp và kháng nghị diễn đàn thiếu bước nhận việc

- [x] WF-31 — P1/Must: Hoàn chỉnh hàng đợi chuyển cấp, nhận kháng nghị và quyết định khôi phục nội dung.
- **Bằng chứng:** `learning.service.ts:2296` chuyển sang ESCALATED nhưng `claimReport:2274` chỉ nhận OPEN và `resolveReport` chỉ xử lý OPEN/IN_REVIEW. `appealReport:2347` chuyển sang IN_REVIEW với assignee null, không đi qua được thao tác claim thông thường; resolve vẫn có thể chạy trực tiếp nên không phải hoàn toàn bế tắc như ESCALATED. `forum/page.tsx:329` chỉ hiện nhóm hành động cho OPEN/IN_REVIEW. KEEP_CONTENT còn đặt `isLocked: false`, có thể bỏ khóa chủ đề vì lý do khác.
- **Triển khai:** BA/BE định nghĩa trạng thái chờ quản trị/chờ nhận kháng nghị; nhận việc có điều kiện trạng thái, cấp xử lý và assignee trong cùng giao dịch. Tách quyết định báo cáo khỏi trạng thái khóa chủ đề; lưu nguyên nhân khóa. FE có hàng đợi theo cấp, người chịu trách nhiệm và hành động hợp lệ do API trả.
- **Nghiệm thu:** Given báo cáo ESCALATED, When quản trị nhận và quyết định, Then có trạng thái kết thúc và thông báo các bên. Given kháng nghị chưa có assignee, Then một người được nhận hợp lệ; hai claim đồng thời chỉ một người thắng. KEEP_CONTENT không tự mở khóa giảng viên đã đặt độc lập.
- **Quyết định:** hiện quyền appeal gắn người báo cáo; cần chốt cả quyền kháng nghị của tác giả bị ẩn và yêu cầu người xét độc lập. Liên kết WF-24/23, không giả định các quyền mới đã được duyệt.

### WF-32 — Retention trộn chính sách được chọn với cutoff khác

- [x] WF-32 — P1/Must: Ghim đúng phiên bản policy và snapshot preview cho toàn bộ lệnh retention.
- **Bằng chứng:** `system.service.ts:379` lấy policy bằng policyId nhưng gọi `previewRetention(policy.category)`. Hàm preview tại `:320` lấy policy mới nhất đang hiệu lực qua `getLatestRetentionPolicy:740`. Execute dùng action của policy được chọn và cutoff của preview, không kiểm tra effectiveAt của policy được chọn.
- **Ảnh hưởng:** chọn policy cũ hoặc chưa đến hiệu lực có thể thực thi action và tuổi dữ liệu không cùng một phiên bản đã phê duyệt. Đây là lỗi khác WF-21 về đóng gói tệp archive.
- **Triển khai:** BE/Data tạo preview theo policyId/version với cutoff, phạm vi, action, dấu vết phê duyệt và thời hạn preview; execute dùng chính snapshot đó, kiểm tra lại legal hold/quyền/hiệu lực. Nếu dữ liệu hoặc policy đổi vượt phạm vi chấp nhận, yêu cầu xem trước lại. FE trình bày rõ version và chênh lệch, không chạy trực tiếp từ tên danh mục.
- **Nghiệm thu:** Given policy v1=365 ngày và v2=30 ngày, When chạy v1, Then không dùng cutoff của v2. Policy chưa hiệu lực bị từ chối. Preview hết hạn hoặc legal hold mới phát sinh không dẫn tới xóa ngoài phê duyệt; retry không chạy lại job đã hoàn tất.
- **Rủi ro:** khả năng H × ảnh hưởng H trên đường mã này; giảm thiểu bằng chặn đưa retention lên dữ liệu thật trước ca kiểm thử policy/preview và phục hồi. Phụ thuộc WF-20/21, VERIFY-02/05.

### WF-33 — Legal hold có tạo nhưng chưa có vòng đời giải tỏa

- [x] WF-33 — P2/Should: Bổ sung danh sách, xem chi tiết và giải tỏa hold theo quyền, có lý do và lịch sử.
- **Bằng chứng:** `system.service.ts:364` và `system.controller.ts:76` có createLegalHold; chưa tìm thấy API release trong mã nguồn. `schema.prisma:1050` có active/releasedAt nhưng chưa có luồng vận hành cập nhật tương ứng.
- **Ảnh hưởng:** sau khi đặt hold, ứng dụng chưa có cách kết thúc có kiểm soát; vận hành dễ phải sửa database thủ công hoặc giữ dữ liệu vô thời hạn.
- **Triển khai:** BA chốt người đủ quyền và yêu cầu phê duyệt; BE thêm lệnh release ghi actor, lý do, thời điểm và lịch sử bất biến. FE hiển thị những hold đang chặn job, không gộp giải tỏa với nút xóa dữ liệu.
- **Nghiệm thu:** Given nhiều hold cùng danh mục, When giải tỏa một hold, Then các hold còn active tiếp tục chặn. Release không tự chạy retention; phải tạo preview/phê duyệt mới. Request lặp không làm mất lịch sử và không tái kích hoạt hold đã kết thúc.
- **Phụ thuộc:** WF-20/32; phạm vi là luồng phần mềm, không xác định thời hạn pháp lý thay người phụ trách.

### WF-34 — Lớp ACTIVE có thể không có giảng viên chính

- [x] WF-34 — P1/Must: Bảo vệ điều kiện giảng viên chính khi phân công, đổi vai trò và kích hoạt lớp.
- **Bằng chứng:** `assignInstructor` tại `learning.service.ts:287` nhận CO_INSTRUCTOR ngay cho thành viên đầu hoặc đổi PRIMARY thành CO_INSTRUCTOR. `activateClass:429` chỉ kiểm tra số giảng viên lớn hơn 0, không kiểm tra PRIMARY. `removeInstructor` lại chặn gỡ PRIMARY cuối: cùng điều kiện nghiệp vụ đang được áp dụng không nhất quán.
- **Triển khai:** một transaction kiểm tra trạng thái lớp và người phụ trách hợp lệ khi activate/assign/change/remove; đề xuất lớp ACTIVE có đúng một PRIMARY, đồng giảng viên là người hỗ trợ. Bàn giao PRIMARY nguyên tử, cập nhật đầu mối và lịch sử; không chỉ tự chọn người đầu tiên ở giao diện.
- **Nghiệm thu:** Given lớp chỉ có đồng giảng viên, When kích hoạt, Then phải chọn người chính hoặc bị chặn với lý do. Given lớp ACTIVE, When hạ vai trò PRIMARY cuối, Then yêu cầu người thay thế trong cùng thao tác. Hai yêu cầu thay PRIMARY đồng thời không để lớp có 0 hoặc 2 người chính.
- **Phụ thuộc:** WF-22, VERIFY-01/02; áp dụng chính sách lịch theo WF-05/task quy tắc lớp hiện có, không lặp hạng mục đó.

### WF-35 — Lớp ghim phiên bản nhưng đọc nội dung khóa học hiện tại

- [x] WF-35 — P1/Must: Đọc đúng snapshot khóa học mà lớp đang sử dụng.
- **Bằng chứng:** createClass lưu courseVersion; `updateCourse:149` sửa Course hiện tại và chuyển DRAFT. `courses/classes/[classId]/page.tsx:54` tải danh mục Course hiện tại, `:71` chọn theo courseId rồi hiển thị cùng số phiên bản của lớp. `getExamGenerationContext:1692`, `:1734` dùng `classItem.course.name/description`, không tra CourseVersion của lớp.
- **Ảnh hưởng:** lớp v1 có thể hiển thị hoặc đưa vào AI nội dung v2 đang soạn; nhãn phiên bản và ngữ cảnh học thực tế không khớp.
- **Triển khai:** BE trả courseSnapshot theo cặp courseId/courseVersion trong hồ sơ lớp và AI context; Data ràng buộc/thẩm định tham chiếu snapshot. Nâng phiên bản lớp là thao tác riêng có xem trước ảnh hưởng, không nâng tự động. FE phân biệt bản lớp đang học với bản mới của danh mục.
- **Nghiệm thu:** Given lớp dùng v1, When sửa draft hoặc phát hành v2, Then tên/nội dung snapshot và nguồn ngữ cảnh v1 không đổi. Chỉ lớp được nâng phiên bản rõ ràng mới đọc v2; dữ liệu cũ thiếu snapshot phải có danh sách đối soát, không âm thầm dùng latest.
- **Phụ thuộc:** WF-12/13, UX-01; chốt cách áp dụng nâng chương trình cho lớp đang học trước migration dữ liệu.

### WF-36 — Công bố chưa tái kiểm tra hạn và lịch lớp

- [x] WF-36 — P1/Must: Dùng cổng kiểm tra điều kiện khi công bố/duyệt, không chỉ lúc tạo nháp.
- **Bằng chứng:** `academic.service.ts:40` kiểm tra dueAt ở tương lai lúc tạo, nhưng `publishAssignment:52` chỉ kiểm tra DRAFT và quyền. `learning.service.ts:1359`, `:1388` không tái kiểm tra lịch đề khi gửi/duyệt. `createSession:2400`, `updateSession:2442` kiểm tra quá khứ/trùng buổi nhưng chưa so khoảng thời gian với startAt/endAt của lớp.
- **Ảnh hưởng:** nháp để lâu có thể được công bố khi đã hết hạn; buổi học có thể nằm ngoài thời gian lớp. Việc có cho học bù/thi bù ngoài lịch là quyết định nghiệp vụ, không mặc định mọi trường hợp ngoài lịch đều sai.
- **Triển khai:** BA chốt giới hạn lịch và ngoại lệ; BE có publication/transition guard dùng đồng hồ máy chủ và trạng thái lớp tại thời điểm commit. FE hiển thị readiness, trường thời gian lỗi và đường gia hạn; ngoại lệ có quyền riêng/lý do/audit. Dùng quy tắc này cho đề thủ công, đề AI, bài tập và buổi học.
- **Nghiệm thu:** Given nháp còn hợp lệ lúc tạo nhưng đã hết hạn, When công bố, Then bị chặn và có đường chỉnh lịch. Given duyệt tay bị trì hoãn quá closeAt, Then không xuất bản đề vô dụng. Buổi ngoài lịch bị chặn hoặc được duyệt ngoại lệ có lịch sử; kiểm thử ranh giới ngày/múi giờ.
- **Phụ thuộc:** WF-04/05/10/15/26; API là nơi thực thi cuối cùng, UI chỉ phản hồi sớm theo cùng quy tắc.

### WF-37 — Danh sách buổi học trả URL bản ghi ngoài cổng kiểm tra

- [x] WF-37 — P1/Must: Không trả URL nguồn bản ghi cho học viên từ API danh sách.
- **Bằng chứng:** `learning.service.ts:2378` chỉ xóa hostUrl khi map danh sách cho LEARNER; `mapSession:3793` vẫn chứa recordingUrl. Trong khi `getSessionSummary:2809` đã xóa URL và `createRecordingAccess:2827` kiểm tra COMPLETED/READY/expiry/thành viên.
- **Ảnh hưởng:** người học có thể nhận URL nguồn khi bản ghi đang PROCESSING hoặc quá hạn theo ứng dụng. Khả năng mở trực tiếp còn phụ thuộc quyền nhà cung cấp; không khẳng định mọi URL đều truy cập được công khai.
- **Triển khai:** BE dùng DTO riêng cho learner, chỉ trả recordingAvailable và trạng thái; mọi thao tác xem đi qua access endpoint. Chốt cơ chế quyền/hạn dùng tại provider hoặc storage, vì thu hồi link ứng dụng không tự thu hồi một URL bên ngoài đã phát hành. FE không cache URL nguồn trong danh sách lâu dài.
- **Nghiệm thu:** Given bản ghi PROCESSING/FAILED/expired, When đọc danh sách hoặc summary, Then payload không có URL nguồn và access bị từ chối. READY đúng quyền xem được; gỡ thành viên chặn cấp link mới, kiểm thử lại hiệu lực của URL đã cấp theo chính sách provider.
- **Phụ thuộc:** WF-16/23; kiểm tra hợp đồng API trước khi tích hợp provider thật, không chỉ ẩn nút UI.

### WF-38 — Hành động hỗ trợ học tập thiếu kết quả và bàn giao

- [x] WF-38 — P2/Should: Khép kín luồng phát hiện rủi ro → giao hỗ trợ → thực hiện → xác nhận kết quả.
- **Bằng chứng:** `learning.service.ts:3118` tự gán ownerId bằng người tạo; `updateProgressIntervention:3137` chỉ chuyển OPEN sang DONE/CANCELLED, không so ownerId dù comment nói kiểm tra chủ sở hữu. `schema.prisma:1203` chưa có kết quả xử lý; `reports/page.tsx:129` gửi duy nhất status DONE. Không thấy thông báo ở hai hàm tạo/kết thúc này.
- **Ảnh hưởng:** nhãn “Giao hỗ trợ” chưa phải bàn giao cho người khác; nhấn hoàn tất không có bằng chứng đã hỗ trợ gì. Báo cáo có thể đếm kết thúc công việc mà không biết kết quả với học viên.
- **Triển khai:** BA phân biệt ghi chú nội bộ và phần được chia sẻ với người học; BE/Data thêm assignee hợp lệ, trạng thái nhận/đang làm/kết thúc, kết quả/lý do hủy và lịch sử bàn giao. Quyền quản lý kết thúc thay owner phải được định nghĩa riêng. FE có danh sách việc của tôi, quá hạn, nội dung kết quả và lịch sử.
- **Nghiệm thu:** Given giao cho giảng viên phụ trách, When tạo, Then người đó nhận đúng việc/thông báo. Người ngoài phạm vi không chốt được; DONE yêu cầu kết quả, CANCELLED yêu cầu lý do. Đổi người phụ trách giữ lịch sử và không biến ghi chú nội bộ thành tin nhắn tự động cho học viên.
- **Phụ thuộc:** WF-08/22/23; không thay điểm, trạng thái học tập hay kỷ luật chỉ vì có nhãn rủi ro.

## I. Phương án triển khai đề xuất

### I.1. Cách tổ chức thay đổi

Ưu tiên hoàn chỉnh từng lát cắt **dữ liệu → API → giao diện → người nhận bàn giao → kiểm thử**, không làm xong toàn bộ backend rồi để giao diện/người nhận công việc sang một dự án khác. Giữ Nest/Prisma/Next và các service hạ tầng hiện có; chưa có căn cứ cần viết lại toàn hệ thống hoặc tách microservice.

- [x] PLAN-01 — P1/Must: Chốt ma trận vai trò × thao tác × quan hệ lớp × trạng thái đối tượng. API trả capabilities và lý do không được thao tác; không để nhiều trang tự suy ra chính sách khác nhau từ tên role. Liên kết WF-04/22/23/27/31/34/37/38.
- [x] PLAN-02 — P1/Must: Chuẩn hóa các lệnh chuyển trạng thái với expectedVersion/trạng thái nguồn, actor từ phiên, kiểm tra nghiệp vụ và audit trong transaction. Dùng cập nhật có điều kiện; lỗi cạnh tranh trả conflict kèm hướng tải lại, không giả thành công. Liên kết WF-03/06/26/30/31/32/34/36.
- [x] PLAN-03 — P1/Must: Chuẩn hóa sự kiện bàn giao qua outbox cùng transaction; worker gửi notification/email có retry và dedup theo eventId/người nhận/kênh. Không dùng trạng thái “đã gửi” cho việc chỉ mới enqueue; không để lỗi gửi tin khiến người dùng tạo lại một nghiệp vụ đã commit. Kết hợp task queue đang có, không tạo hàng đợi độc lập cho mỗi màn hình.
- [x] PLAN-04 — P1/Must: Chuẩn hóa snapshot/asset reference và kế hoạch migration. Đối soát version thiếu, object đang dùng chung, lượt thi/bài nộp và archive; migration có báo cáo trước/sau, không tự sửa điểm hoặc xóa dữ liệu không rõ nguồn.
- [x] PLAN-05 — P1/Must: Phân rã mỗi WF theo BE/Data, FE và QA sau khi chốt quy tắc. Gán một người chịu trách nhiệm toàn luồng; effort/owner/deadline để nhóm xác nhận, không tự ước lượng thành cam kết.

### I.2. Thứ tự thực hiện và điều kiện qua giai đoạn

| Giai đoạn | Phạm vi | Kết quả bàn giao và điều kiện qua cổng |
|---|---|---|
| 0 — Chốt quy tắc và dữ liệu thử | PLAN-01/05, quyết định mục F/J, QA-R2-01 | Có ma trận quyền, policy đã chọn, database test riêng và ca tái hiện trước sửa. Task chưa rõ policy không chuyển Ready. |
| 1 — Chặn sai dữ liệu/quyền | WF-01/03/04/06/21/27/28/32/34/37, PLAN-02/04 | Không mất asset/bài làm; không lách thu hồi qua version/list; không chạy retention sai policy; chấm lần đầu thực hiện được. Kiểm chứng MySQL trước phát hành. |
| 2 — Khép kín đánh giá và học liệu | WF-02/07/08/09/10/11/12/13/26/35/36, UX-02 | Giảng viên tạo/sửa/duyệt/chấm, học viên làm/xem/phúc khảo đi hết vòng; một chính sách điểm và snapshot nguồn truy vết được. |
| 3 — Bàn giao vận hành | WF-14/15/18/19/20/24/29/30/31/33/38, PLAN-03 | Ticket/báo cáo/hỗ trợ có người nhận, xem được bằng chứng và kết thúc có kết quả. Retry không tạo công việc trùng. |
| 4 — Không gian lớp và liên lạc | UX-01/03/04, WF-22/23/25, CHAT-01…07 | Danh bạ đúng phạm vi → mở đúng hội thoại → đồng bộ thành viên; nhóm lớp đóng chỉ đọc; UAT-16 đạt trước mở cho người dùng. |
| 5 — Tích hợp thật và phát hành có kiểm soát | WF-16/17, VERIFY-01…08, QA-R2-01…03 | Provider thật chỉ bật sau live test; đối soát UAT cũ/mới, rollback và metric. Chức năng đang Blocked không được trình bày là đã chạy production. |

Các giai đoạn thể hiện phụ thuộc và thứ tự ưu tiên, không phải lịch tuần/sprint đã cam kết. Có thể triển khai độc lập một lát cắt đã đủ điều kiện; không cần đợi toàn bộ project xong mới bàn giao. CHAT-08 giữ P3/giai đoạn sau.

### I.3. Kiểm thử và phát hành

- [x] QA-R2-01 — P1/Must: Tạo môi trường MySQL thử độc lập với tài khoản ít nhất hai người mỗi vai trò, hai lớp khác phạm vi và một lớp đóng. Chặn chạy test ghi/xóa nếu không xác nhận đúng database test; không dựa vào `.env` đang mở để suy ra đây là dữ liệu dùng một lần.
- [x] QA-R2-02 — P1/Must: Viết ca tái hiện WF-27…38 trước sửa, chạy cả unit và integration cho các nhánh liên quan; test bộ nhớ không thay thế transaction/unique/decimal thực của MySQL. Lưu command, commit/working-tree, dữ liệu thử, expected/actual và bằng chứng UI/API.
- [x] QA-R2-03 — P1/Must: Chạy UAT liên vai trò theo bảng dưới và UAT-01…16 vòng 1. Mỗi lần bàn giao kiểm tra người gửi, người xử lý, người nhận kết quả, refresh/đăng nhập lại và truy cập đã thu hồi. Bằng chứng từng ca được ghi tại K.3.

| Ca mới | WF liên kết | Tình huống bắt buộc |
|---|---|---|
| UAT-17 | WF-27 | Phát hành v1 → tạo v2 nháp → ẩn/thu hồi toàn tài liệu → thử link lịch sử đã cấp; phân biệt draft và revoke. |
| UAT-18 | WF-28 | Thi với ảnh v1 → tạo ảnh v2 → xem lại bài đã nộp → dọn asset không còn dùng; v1 còn nguyên. |
| UAT-19 | WF-29 | Người gửi/nhân sự hợp lệ mở PDF/ảnh ticket; người ngoài bị chặn; đóng ticket vẫn giữ hồ sơ theo policy. |
| UAT-20 | WF-30 | Tạo ticket commit → upload timeout → retry và double-click; không tạo thêm phiếu/tệp. |
| UAT-21 | WF-31 | Quản lý chuyển cấp → admin nhận/giải quyết → kháng nghị/nhận lại; quyết định giữ nội dung không bỏ khóa độc lập. |
| UAT-22 | WF-32 | Chọn v1 khi v2 đã hiệu lực, chọn policy tương lai, preview hết hạn và legal hold phát sinh sau preview. |
| UAT-23 | WF-33 | Hai hold cùng danh mục → giải tỏa một → vẫn được bảo vệ; release không tự xóa dữ liệu. |
| UAT-24 | WF-34 | Lớp chỉ có đồng giảng viên, hạ vai trò người chính cuối, hai yêu cầu chuyển PRIMARY đồng thời. |
| UAT-25 | WF-35 | Lớp v1 → sửa draft khóa học v2 → mở hồ sơ/AI context → nâng phiên bản có kiểm soát. |
| UAT-26 | WF-36 | Nháp hết hạn trước khi công bố, duyệt đề sau closeAt, buổi bù ngoài lịch lớp và ranh giới múi giờ. |
| UAT-27 | WF-37 | Payload danh sách không lộ URL nguồn khi PROCESSING/expired; READY cấp quyền đúng; gỡ thành viên thu hồi đúng chính sách. |
| UAT-28 | WF-38 | Giao việc → nhận → bàn giao người mới → hoàn tất có kết quả; người không có quyền không chốt được. |

**Điều kiện Done:** đạt tiêu chí WF trên API lẫn giao diện, có test regression và xác nhận của vai trò nhận bàn giao; schema/migration kiểm chứng trên bản sao; không còn lỗi P1 chưa xử lý trong luồng chuẩn bị phát hành. Test xanh hoặc cập nhật checklist riêng lẻ không đủ để tick Done.

**Rollout đề xuất:** triển khai additive schema trước, kiểm tra/backfill dữ liệu có báo cáo, bật theo lớp thử, đối soát số bản ghi/asset/điểm và thông báo; sau đó mở rộng. Chuẩn bị cờ tắt tính năng mới và cách quay về bản ứng dụng tương thích schema. Không rollback bằng xóa bài nộp/điểm mới; nếu schema đã đổi, ưu tiên forward-fix có kiểm soát.

**Chỉ số theo dõi:** task không có người nhận, thời gian chờ nhận/chờ chấm, yêu cầu chuyển trạng thái bị conflict, nghiệp vụ/tệp trùng sau retry, link sai/mất quyền, chênh lệch tổng điểm, outbox lỗi/tồn đọng và số asset không khôi phục được. Ngưỡng cảnh báo/hiệu năng cần đặt sau baseline, không bịa SLA chưa đo.

## J. Quyết định còn mở bổ sung vòng 2

Các phương án dưới là đề xuất để refinement, chưa thay đổi chính sách sản phẩm:

| ID | Cần chốt | Phương án đề xuất / đánh đổi | Người xác nhận đề xuất |
|---|---|---|---|
| DEC-08 | Ẩn bản hiện tại hay thu hồi toàn tài liệu? | Tách rõ hai lệnh; soạn v2 không chặn v1, thu hồi/cách ly chặn toàn bộ phạm vi bị ảnh hưởng. Nhiều trạng thái hơn nhưng tránh thu hồi không hiệu lực. | Quản lý học liệu + giảng viên |
| DEC-09 | Đổi chương trình cho lớp đang học? | Ghim snapshot; nâng phiên bản bằng lệnh có xem trước thay đổi, không dùng latest tự động. Tốn đối soát nhưng giữ đúng chương trình đã giao. | Quản lý trung tâm |
| DEC-10 | Thi/bài tập/buổi bù ngoài thời gian lớp? | Mặc định theo lịch lớp, ngoại lệ có quyền/lý do/hạn riêng. Không khóa cứng mọi buổi bù cũng không mở tự do. | Quản lý đào tạo |
| DEC-11 | Ai được kháng nghị và ai xử lý cấp tiếp? | Phân biệt người báo cáo và tác giả bị tác động; chuyển cấp giao nhóm khác, xác định có bắt buộc người xét độc lập hay không. | Quản lý + quản trị |
| DEC-12 | Quyền truy cập link bản ghi sau khi rời lớp? | Cổng ứng dụng kiểm tra từng lần; provider/storage phải có cơ chế tương ứng. URL public dài hạn không đáp ứng thu hồi tức thì. | Chủ hệ thống + quản lý đào tạo |
| DEC-13 | Ai giải tỏa hold và ai xác nhận công việc hỗ trợ? | Lệnh riêng, actor xác thực, lý do và lịch sử; không suy diễn từ quyền xem báo cáo. Chốt một hay hai cấp phê duyệt theo thao tác. | Chủ hệ thống + quản lý trung tâm |

**Bước triển khai đầu tiên đề xuất:** PLAN-01, QA-R2-01 và ca tái hiện WF-01/27/28/32/34/37. Đây là nền để sửa chấm bài và bảo toàn dữ liệu trước khi tăng thêm chức năng chat. Không cần viết lại project để thực hiện phương án này.

## K. Nhật ký triển khai 06/09/2026

Phạm vi mã nguồn của CHAT-01…07, UX-01…04, WF-01…38, VERIFY-01…07, PLAN-01…05 và QA-R2-01…03 đã hoàn tất. Trạng thái dưới đây phản ánh nghiệm thu thực tế trên database thử độc lập; không coi tích hợp bên ngoài chưa có thông tin xác thực là đã chạy live.

| Hạng mục | Trạng thái | Kết quả đã nghiệm thu |
|---|---|---|
| CHAT-01…07 | Done | Danh bạ theo lớp; chat riêng duy nhất; chat lớp theo membership; SSE, unread, cursor, idempotency, reply/tệp/mention/search/mute/report/block; bản nháp, vị trí đọc, mobile; thẻ ngữ cảnh tái kiểm tra quyền. |
| UX-01…04 | Done | Không gian lớp và deep link theo `classId`; một hàng đợi chấm nhóm lớp → bài → bài nộp; dashboard tính bài tập + bài thi; lịch/kết quả/thông báo cùng trạng thái nghiệp vụ. |
| WF-01…13 | Done | Chấm tự luận/sửa điểm/phúc khảo; khóa đóng lớp và cạnh tranh; ghi danh muộn; gradebook; vòng đời đề/câu AI, điểm từng câu, tài liệu theo khóa học/môn học và nguồn AI truy vết. |
| WF-14…26 | Done | Deep link thông báo/lịch; phòng Jitsi thật và hiển thị provider; khoảng điểm danh; support; export thật; restore drill/operational; archive có asset/checksum; đổi vai trò có impact/handoff; quyền theo quan hệ; diễn đàn; KPI; vòng đời bài tập. |
| WF-27…38 | Done | Thu hồi version; ảnh câu hỏi bất biến; bằng chứng support; retry thành công một phần; moderation appeal/escalation; retention snapshot; legal hold UI/API/audit; PRIMARY handoff; course snapshot; publication gates; recording access; intervention workflow. |
| VERIFY-01…06 | Done | Khóa hàng/transaction/version bảo vệ ghi danh, đóng lớp, nộp/chấm, lưu đáp án; cleanup storage có retry; quyền phiên được kiểm tra lại trên request và stream. |
| PLAN-01…04 | Done | Capabilities theo quan hệ; state command có `expectedVersion`; transactional outbox có retry/dedup; snapshot/asset migration và kiểm tra archive. |
| REV-02 / VERIFY-07 / QA-R2-02…03 | Done | UAT-01…28 được đối chiếu trên dữ liệu `_test`; có ca dữ liệu rỗng/nhiều bản ghi/legacy/timezone và E2E desktop/mobile/bàn phím. |
| PLAN-05 | Done | Wind Of Fall chịu trách nhiệm xuyên suốt BE/Data → FE → QA; effort được ghi theo quy mô thực tế và ngày hoàn tất, không biến ước lượng cũ thành cam kết. |

### K.1. Bằng chứng kỹ thuật

- Database thử riêng: `trung_tam_giang_day_test`; lệnh `pnpm --filter @wind-of-fall/api db:test:prepare` chỉ cho phép tạo/reset database có hậu tố `_test`, reset bắt buộc `--confirm`.
- Migration mới đã áp dụng trên database local và database thử: regrade, AI context/idempotency, progress intervention, chat, attendance intervals, assignment lifecycle, operational restore/export + job queue, notification outbox và material course scope.
- Integration trên database thử: **18 file / 134 test đạt**; chạy tuần tự để loại deadlock giả giữa các file dùng chung fixture. **Web 25 test đạt**, lint/typecheck sạch và build production **31 route**.
- Playwright E2E: **4/4 đạt** trên Chromium desktop và Pixel 7; kiểm tra đăng ký → xác minh, đăng nhập, dashboard, hồ sơ, dữ liệu rỗng, không tràn ngang, menu/Escape/bàn phím và Axe không có lỗi serious/critical.
- Impeccable detector không phát hiện vi phạm trên dashboard/shell/token giao diện được thay đổi; lint và E2E kiểm tra lại màn hỗ trợ sau khi bổ sung idempotency.
- UAT trình duyệt thật đã đi qua INSTRUCTOR, LEARNER, CENTER_MANAGER và SYSTEM_ADMIN: dashboard, notification click-outside, kho tài liệu, chat/deep link, chấm bài hợp nhất, đề/kết quả, forum, class hub, intervention, export/restore/outbox và vòng đời legal hold.
- Tạo và giải tỏa legal hold đã được xác minh đủ bản ghi audit `LEGAL_HOLD_CREATED` và `LEGAL_HOLD_RELEASED`.

### K.2. Mục còn mở ngoài phạm vi triển khai nội bộ

| Mã | Trạng thái chính xác | Điều kiện đóng |
|---|---|---|
| CHAT-08 | Deferred/P3 | Chỉ triển khai liên hệ ngoài lớp và nhóm tự tạo khi chủ sản phẩm xác nhận nhu cầu; không thuộc chat phiên bản đầu theo DEC-02…05. |
| TASK-BE-053 / TASK-BE-062 | Blocked external | Jitsi production đã hoạt động. Google Meet/Zoom cần OAuth app, redirect URI, webhook secret và Pub/Sub/event subscription thật; hệ thống cố ý không tạo URL mô phỏng hoặc coi credential reference là kết nối thành công. |
| VERIFY-08 | Blocked external | Cần API key/provider AI thật để chạy live về chất lượng, timeout và nguồn. Luồng provider, chống tạo trùng và xử lý lỗi đã có; database thử hiện không cấu hình provider. |

### K.3. Bằng chứng UAT-01…28

| Ca | Kết quả | Bằng chứng chạy trên database thử / giao diện |
|---|---|---|
| UAT-01 | Đạt | `auth-registration.e2e.test.ts`, `auth-google.e2e.test.ts` và Playwright đăng ký → màn xác minh → đăng nhập → hồ sơ. |
| UAT-02 | Đạt | `learning.service.test.ts` — cấu hình lớp, PRIMARY, phiên bản khóa học; UAT browser lớp và class hub của quản lý. |
| UAT-03 | Đạt | `business-concurrency.integration.test.ts` và test import/gỡ/ghi danh lại; hai request chỗ cuối chỉ một thành công. |
| UAT-04 | Đạt | Test material bytes/checksum/version/review/archive; giao diện kho tài liệu nhóm theo khóa học/lớp. |
| UAT-05 | Đạt nội bộ | Test vòng đời câu hỏi/đề, AI draft/source/điểm và duyệt/trả; provider live tách riêng VERIFY-08. |
| UAT-06 | Đạt | Test autosave idempotent, auto-submit hết giờ, chấm tự luận lần đầu và cô lập attempt theo học viên. |
| UAT-07 | Đạt | Test công bố đúng chủ sở hữu, phúc khảo duy nhất, claim/resolve và lịch sử sửa điểm; UI kết quả/phúc khảo đã đi liên vai trò. |
| UAT-08 | Đạt | `academic.service.test.ts` chạy tạo → xuất bản → nộp/nộp lại → rubric → sửa điểm/gia hạn/đóng bài. |
| UAT-09 | Đạt nội bộ | Test Jitsi URL, vào/rời/vào lại, attendance interval, khóa và appeal; provider có credential ngoài Jitsi không được giả là live. |
| UAT-10 | Đạt | Test chủ đề/phản hồi, khóa/ẩn, report/claim/resolve/escalate/appeal và lớp đóng chỉ đọc. |
| UAT-11 | Đạt | Test ticket theo reporter/đội hỗ trợ, comment, assignee, resolution và đóng bởi người gửi; UI mở/tải bằng chứng. |
| UAT-12 | Đạt | Test gradebook/report thống nhất và intervention giao nhận/bàn giao/kết quả; UI báo cáo đã đi qua manager/instructor. |
| UAT-13 | Đạt | Test điều kiện đóng lớp, archive chỉ đọc, mở lại/đóng lại và dedup thông báo. |
| UAT-14 | Đạt | Test export tệp thật/checksum/hạn tải, restore drill/operational, archive asset; UI operations đã xác minh. |
| UAT-15 | Đạt | `identity.service.test.ts`, isolation E2E và UAT browser đổi/thu hồi quyền, xem impact/handoff và đăng nhập lại. |
| UAT-16 | Đạt | `chat.service.test.ts` trên user fixture độc lập: danh bạ, direct idempotent, unread/read, context, report/block; UI desktop/mobile/deep link. |
| UAT-17 | Đạt | Link version cũ tải được trước khi thu hồi và bị chặn ngay sau khi tài liệu cha chuyển HIDDEN; draft version không thay bản phát hành. |
| UAT-18 | Đạt | Test ảnh câu hỏi tạo version mới, kế thừa/gỡ asset và chỉ trả ảnh khi attempt còn quyền; bản cũ giữ checksum. |
| UAT-19 | Đạt | Test đọc đúng bytes bằng chứng cho reporter/admin và trả NotFound cho người ngoài; controller stream tên/MIME đúng. |
| UAT-20 | Đạt | Red: hai request đồng thời cùng khóa gây `P2002`; green: API trả cùng ticket ID, MySQL chỉ một row, UI khóa double-click và retry tệp đúng ticket. |
| UAT-21 | Đạt | Test manager chuyển cấp, admin claim/resolve, appeal và KEEP_CONTENT không tự ẩn nội dung; audit/notification đúng bên. |
| UAT-22 | Đạt | Test policy v1/v2 dùng đúng cutoff/action, policy tương lai bị chặn và legal hold được tái kiểm tra tại lúc chạy. |
| UAT-23 | Đạt | Hai legal hold cùng category; giải tỏa một hold vẫn giữ toàn bộ bản ghi được hold còn lại bảo vệ; audit create/release có đủ actor/lý do. |
| UAT-24 | Đạt | Test PRIMARY handoff nguyên tử, yêu cầu cũ bị conflict và roster luôn đúng một PRIMARY. |
| UAT-25 | Đạt | Test lớp ghim course snapshot v1 khi course tạo v2; AI context và class hub đọc đúng phiên bản lớp. |
| UAT-26 | Đạt | Guard công bố kiểm tra hạn theo server/lịch lớp; test thời gian lớp/múi giờ và session ngoài cửa sổ bị chặn. |
| UAT-27 | Đạt | Test payload PROCESSING không có URL, READY cấp link ký đúng, chữ ký sai/quá hạn bị chặn và quyền được kiểm tra lại. |
| UAT-28 | Đạt | Test intervention giao cho giảng viên cùng lớp, bàn giao giữ lịch sử, người ngoài không chốt và DONE/CANCELLED buộc kết quả/lý do. |

**Dấu vết QA-R2-02:** base commit trước đợt sửa `628a2ed`; working tree hiện tại chứa mã, migration và test regression. Lệnh xác nhận: `DB_NAME=trung_tam_giang_day_test pnpm --filter @wind-of-fall/api test` → 134/134; `pnpm --filter @wind-of-fall/web test` → 25/25; `pnpm --filter @wind-of-fall/web exec playwright test` → 4/4; lint/typecheck/build đều đạt. Dữ liệu thử có 12 lớp, 326 ghi danh, 72 tài liệu, 120 câu hỏi, 24 đề, 414 lượt thi, 36 bài tập và 700 bài nộp. Expected/actual của từng WF nằm trong assertion tương ứng; red→green WF-30 được ghi rõ ở UAT-20.

### K.4. Phân công thực tế PLAN-05

| Phạm vi | BE/Data | FE | QA | Owner xuyên suốt | Effort thực tế | Ngày hoàn tất |
|---|---|---|---|---|---|---|
| WF-01…13 | API/schema/migration đánh giá, AI, học liệu | Đề, kết quả, chấm bài, materials | Unit + MySQL + UAT-04…08 | Wind Of Fall | XL — nhiều phân hệ | 2026-09-06 |
| WF-14…26 | Notification, lịch, attendance, support, export/restore, RBAC | Header, lịch, support, operations, forum | Unit + isolation + UAT-09…15 | Wind Of Fall | XL — liên vai trò | 2026-09-06 |
| WF-27…38 | Version/asset, moderation, retention, handoff, gates | Materials, support, forum, operations, reports | Regression + 127 integration + UAT-17…28 | Wind Of Fall | XL — transaction/data | 2026-09-06 |
| CHAT-01…07 / UX-01…04 | Chat/SSE/membership/context | Messages, class hub, grading queue, responsive | Unit + UAT-16 + browser desktop/mobile | Wind Of Fall | XL — tính năng mới | 2026-09-06 |

Effort là kích thước công việc đã thực hiện để phục vụ hậu kiểm, không phải số giờ hay cam kết sprint được dựng lại sau sự kiện.

## AI bộ ôn tập — khóa bền vững (2026-09-08)

- [x] Replay bộ ôn tập qua cùng yêu cầu không còn phụ thuộc provider đang bật: tra claim đúng owner/material/version/options trước bước kiểm tra cấu hình; yêu cầu mới thiếu model không giữ khóa. Vẫn kiểm tra quyền nguồn trước trả kết quả; không trích xuất hoặc gọi provider khi cache hit. 23 test store/context và 4 test MySQL đạt sau sửa, typecheck/lint phần sửa đạt (2026-09-09).
- [x] Kiểm tra hồi quy API trước thay đổi replay trên: 500 test đạt, 33 bị skip theo cấu hình; không tính các test skip là đã kiểm chứng. Không gọi provider thật trong kiểm thử AI.

- [x] Loại bỏ toàn bộ fallback RAM trong AiStudyDraftService. Thiếu/tắt database trả 503 cho generate/get/list/edit/publish/unpublish/getPublished/listPublished; lỗi ghi claim không gọi provider. Giữ nguyên unique fingerprint, cập nhật có điều kiện, snapshot phát hành và phân trang metadata. Thông báo mới có tiếng Anh.
- [x] Unit fixture mô phỏng database tách khỏi mã sản phẩm; 42 test qua bốn bộ draft/edit/context/MySQL đạt, bao gồm tạo đồng thời, replay sau thay service, UNCERTAIN, chỉnh sửa/phát hành đồng thời và thu hồi. Typecheck/lint phần sửa đạt. Provider trong test là mô phỏng, chưa phải UAT live.

## AI hỏi đáp tài liệu — lưu trả lời và chống gửi lặp (2026-09-08)

- [x] Hỏi đáp tài liệu lưu kết quả riêng bằng claim database theo người tạo/tài liệu/phiên bản/câu hỏi đã trim/ngôn ngữ; khóa là hash, không chứa nguyên câu hỏi. Unique insert trước model trả lời; OCR có claim độc lập và hoàn tất trước khi giữ khóa trả lời. READY dùng lại sau restart, GENERATING/UNCERTAIN chặn gọi lại. Không fallback memory nếu database tắt/lỗi. Thông báo Việt–Anh. Từ 2026-09-09, yêu cầu mới lưu metadata riêng gồm câu hỏi để phục vụ lịch sử như ghi bên dưới.
- [x] Nối vào `AiMaterialContextService.ask`: kiểm tra quyền tài liệu và phiên bản trước cache, ghim version khi chuẩn bị ngữ cảnh; kiểm tra lại quyền trước trả kết quả. Replay đọc status không resolve model hoặc gọi provider. Lỗi trong callback model trả lời giữ UNCERTAIN; lỗi chuẩn bị OCR không tạo claim trả lời mới và không mở khóa claim OCR.
- [x] Kiểm thử MySQL: cạnh tranh sáu service, replay sau restart, phân biệt chủ sở hữu/phiên bản/ngôn ngữ/câu hỏi, mất phản hồi và sai version kết quả; bốn integration case và một test database thiếu đạt. Test context bổ sung xác nhận quyền trước/sau replay, mất quyền và không resolve provider khi cache hit. Provider là giả lập, không phải UAT live.
- [x] API trạng thái hỏi đáp chỉ đọc: `POST /instructor/materials/:materialId/ai-question/status` trả 200/no-store, nhận question/language trong body để không đưa câu hỏi vào URL. Bốn trạng thái NOT_REQUESTED/GENERATING/READY/UNCERTAIN; READY kèm kết quả. Không tạo claim, gọi model hay trích xuất; kiểm tra quyền và version trước/sau đọc. Cả endpoint sinh trả lời cũng có no-store.
- [x] QA trạng thái: 9 HTTP test route/guard/DTO thật với biên service mock xác nhận body, mặc định VI, no-store, 401/403 và chặn trường thừa/model/owner. Bộ MySQL trả lời có 5 integration case + 1 test thiếu database; test pending xác nhận đọc không đổi snapshot. Hai bộ store/context tổng 20 đạt; typecheck/lint đạt.
- [x] Giao diện hỏi đáp có nút Kiểm tra kết quả chỉ gọi API trạng thái, hiển thị đủ NOT_REQUESTED/GENERATING/READY/UNCERTAIN; hết thời gian chờ hướng người dùng tra cứu, không tự gửi lại AI. Đổi câu hỏi/ngôn ngữ xóa kết quả cũ. Bốn test trạng thái xác nhận đúng endpoint và không tự gọi thêm; toàn bộ frontend 109 test đạt, typecheck/lint phần sửa đạt, catalog 2.195/2.195 chuỗi. Kiểm tra trình duyệt desktop 1440×1000/mobile 390×844 với API mô phỏng: đọc kết quả, cuộn tới nguồn, không tràn ngang và focus bàn phím trong modal; không phải UAT provider thật.
- [x] Backend đối soát hỏi đáp: GET `/admin/ai-operations/document-answers`, chỉ SYSTEM_ADMIN có system:configure, no-store. SQL chỉ chiếu mã claim/updatedBy/trạng thái/version/thời điểm; không tải câu hỏi, câu trả lời, citations hoặc cấu hình. Mặc định GENERATING/UNCERTAIN, trạng thái lạ được hiển thị UNCERTAIN; keyset theo thời điểm và mã, giới hạn 1–50, cursor mất trả 400. Không reset/retry/gọi AI. 21 HTTP test mới, tổng ba bộ HTTP đối soát 82 đạt; bộ MySQL hỏi đáp 7 đạt gồm kiểm tra phân trang, metadata và snapshot không đổi; typecheck/lint phần sửa đạt. READY ở hàng đợi phản ánh nhãn lưu trữ, chưa phải kiểm định toàn bộ cấu trúc kết quả.
- [x] Admin có lựa chọn Hỏi đáp tài liệu trong panel đối soát hiện có: tải chủ động từ document-answers, lọc ba trạng thái, phân trang, hiển thị metadata hai cột và mã dài xuống dòng. READY ghi Đã lưu câu trả lời; giải thích trạng thái lưu trữ không chứng minh độ đúng và version tác vụ khác version nguồn. Không có nút sinh lại/xóa/mở nội dung riêng; đổi domain hủy yêu cầu cũ, bỏ phản hồi muộn và reset bộ lọc/cursor. 111 test frontend đạt, typecheck/lint phần sửa đạt, catalog 2.198/2.198; trình duyệt desktop/mobile với metadata mô phỏng không tràn ngang. Không phải UAT provider thật.
- [x] Kiểm tra dữ liệu trả lời trước lưu và trước replay/status bằng cùng schema: nội dung 1–20.000 ký tự không toàn khoảng trắng, boolean/ngữ cảnh, warning, model tùy chọn; tối đa 8 trích dẫn, ID không trùng, đúng material/version, page/offset hợp lệ. Câu trả lời đủ căn cứ phải có nguồn, thiếu căn cứ không kèm nguồn. Loại trường ngoài hợp đồng; cache hỏng trả trạng thái UNCERTAIN và chặn replay không gọi AI/không sửa bản ghi. Kết quả mới hỏng giữ khóa UNCERTAIN. 43 ca kiểm tra dữ liệu đạt, cộng context là 57; bộ MySQL 7 đạt, typecheck/lint phần sửa đạt. Hàng đợi admin vẫn phản ánh nhãn lưu trong database, chưa kiểm định nội dung cache qua SQL.
- [x] Nền lưu lịch sử hỏi đáp (2026-09-09): claim mới giữ request gồm materialId/version/question đã trim/language qua GENERATING/READY/UNCERTAIN. Không ghi metadata này vào khóa hoặc phản hồi hàng đợi admin; cấu hình hệ thống chỉ đọc key platform, không liệt kê toàn bộ claim. Bản ghi cũ không được tự bổ sung câu hỏi hoặc gọi lại AI. 71 test validation/MySQL/HTTP đối soát đạt, typecheck/lint phần sửa đạt. Đây mới là lưu dữ liệu, chưa có API/UI lịch sử riêng.
- [x] Truy vấn lịch sử riêng theo owner/material/version, 20 mục mỗi trang, keyset thời điểm/hash; chỉ lấy câu hỏi/ngôn ngữ/trạng thái/thời điểm, không tải answers/citations. Kiểm tra metadata khớp hash trước trả; cursor của scope khác bị từ chối. Bản ghi cũ thiếu request metadata không tự sinh lịch sử giả. Service kiểm tra quyền tài liệu/phiên bản trước và sau đọc; không gọi provider. 51 test validation/MySQL và 17 test context đạt, typecheck/lint phần sửa đạt. MySQL kiểm tra 25 mục cùng timestamp, ba chiều cách ly và snapshot không đổi. Chưa mở HTTP route hoặc UI.
- [x] HTTP lịch sử: GET `/instructor/materials/:materialId/ai-questions?version=...&cursor=...`, quyền material:manage, owner lấy từ session, no-store. DTO bắt buộc version nguyên dương tối đa 2.147.483.647, cursor hash 64 ký tự; chặn trường thừa/owner/model/question/limit và query lặp. 17 HTTP case mới; tổng status/history/context 43 đạt, typecheck/lint phần sửa đạt. Service phía sau kiểm tra quyền nguồn trước/sau đọc; không có thao tác AI mới.
- [x] Giao diện lịch sử riêng trong hộp hỏi đáp, thu gọn mặc định và chỉ tải khi bấm; phân trang theo version hiện tại, hiển thị câu hỏi/ngôn ngữ/trạng thái/ngày tạo. Chọn câu hỏi điền lại nội dung và ngôn ngữ, focus ô nhập, không tự gọi AI; dùng Kiểm tra kết quả để đọc lại. Hủy đọc khi unmount/đổi công cụ, timeout 30 giây, không tự retry, lỗi bỏ dữ liệu cũ. 120 test frontend đạt, typecheck/lint phần sửa đạt; catalog frontend 2.207/2.207, API 665/665. Browser dữ liệu mô phỏng desktop 1440×1000/mobile 390×844 không tràn ngang và focus đúng; chưa phải UAT provider thật.
- [x] API kiểm tra câu trả lời nhận version tùy chọn để đọc cache phiên bản cũ, mặc định vẫn là phiên bản hiện tại. Kiểm tra quyền đúng version trước/sau đọc; không gọi provider. Endpoint sinh câu trả lời vẫn từ chối trường version để không sinh ngầm trên nguồn cũ. 50 test HTTP/context đạt; typecheck và lint phần sửa đạt. UI chưa có bộ chọn phiên bản cũ.
- [x] UI có ô chọn số phiên bản lịch sử trong khoảng 1 đến phiên bản hiện tại; đổi phiên bản xóa danh sách/cursor, không tự tải. Chọn câu hỏi cũ ghim version vào kiểm tra kết quả và khóa gửi mới cả button lẫn submit handler. Nút Dùng phiên bản hiện tại chuyển lại rõ ràng, không tự gọi AI. 16 test component liên quan đạt; typecheck/lint đạt.
- [x] Hoàn thiện hướng dẫn chống gọi lại từ lịch sử: nhãn phiên bản nguồn theo đúng số đang chọn; kết quả NOT_REQUESTED ở phiên bản cũ hướng dẫn chuyển về hiện tại, không gợi ý gửi khi nút đang khóa. Full frontend 121/121 test đạt; typecheck/lint phần sửa đạt, catalog 2.211/2.211 frontend và 665/665 API. Browser API mock xác nhận đọc version 1, khóa gửi mới, mở khóa có chủ ý khi chuyển về hiện tại; đã xem ảnh desktop 1440×1000/mobile 390×844, không tràn ngang. Không gọi provider thật; impeccable giữ hướng dẫn phù hợp trạng thái chỉ đọc, không thay thiết kế chung.
- [x] OCR học liệu dùng `AiDocumentExtractionStore`: claim unique bền vững trước provider, CAS lưu READY/UNCERTAIN; bỏ cache RAM và gộp request chỉ trong một tiến trình. Giữ key nguồn/version/checksum/model cũ, đọc cache array cũ sau kiểm tra thứ tự trang, giới hạn 200 trang/500.000 ký tự và nội dung không rỗng; không tự tái sinh cache hỏng. Lỗi hoặc mất phản hồi giữ khóa; thiếu database chặn trước OCR. Vẫn kiểm tra quyền trước/sau ở context service.
- [x] QA OCR chống trùng: 32 test store/context/MySQL đạt, gồm sáu worker dùng một lần trích xuất, replay sau tạo lại service, UNCERTAIN không retry và cache cũ không bị sửa. Unit test mất ACK xác nhận không ghi đè READY thành UNCERTAIN. Full API 543 đạt/37 skip theo cấu hình; typecheck/lint đạt, catalog API 672/672. Provider giả lập, database MySQL `_test` thật ở bộ chuyên biệt, chỉ dọn fixture của lượt test. Đây là nền tảng trích xuất học liệu, chưa nối OCR vào bài nộp PDF/ảnh/Word.
- [x] Store OCR có `status` chỉ đọc theo key nội bộ: NOT_REQUESTED/GENERATING/READY/UNCERTAIN; dùng chung bộ kiểm tra snapshot với replay, cache cũ hợp lệ trả READY, cache hỏng trả UNCERTAIN không sửa dữ liệu. Kiểm tra key và database trước đọc. 38 test unit/context và 3 MySQL test đạt; typecheck/lint đạt. MySQL kiểm chứng đọc trạng thái không đổi record. Chưa mở endpoint cho client; lớp gọi vẫn phải kiểm tra quyền nguồn trước/sau.
- [x] API đối soát OCR `GET /admin/ai-operations/extractions`: SYSTEM_ADMIN + system:configure, no-store, mặc định GENERATING/UNCERTAIN, READY tùy chọn, keyset và giới hạn 20 mặc định/50 tối đa. SQL chỉ chiếu mã claim/người tạo/phiên bản tác vụ/thời gian/trạng thái; không tải trang OCR hoặc cấu hình model. Cache array cũ xếp READY theo dạng lưu, không khẳng định nội dung/độ chính xác đã được kiểm định. Không có retry/reset/delete.
- [x] QA API đối soát OCR: 42 HTTP test chung hỏi đáp/OCR đạt, dùng controller/service/guard/DTO thật với biên SQL/auth giả lập; 4 MySQL extraction test đạt gồm phân trang đồng timestamp, trạng thái lạ, legacy READY và snapshot không đổi. Typecheck/lint đạt; không gọi provider thật, chỉ dọn fixture riêng trong `_test`.
- [x] Giao diện cấu hình admin có loại Trích xuất tài liệu OCR, đọc `/admin/ai-operations/extractions`, lọc ba trạng thái và phân trang. Đổi loại hủy đọc cũ, bỏ phản hồi muộn và đặt lại bộ lọc/cursor; không có retry/reset/delete. Nhãn READY là Đã lưu trích xuất, nêu rõ cache cũ và trạng thái lưu không chứng minh đầy đủ/chính xác; phiên bản tác vụ khác phiên bản nguồn. Giữ giao diện hiện có theo impeccable.
- [x] QA frontend OCR: tổng 123 test đạt, typecheck/lint đạt, catalog frontend 2.215/2.215 và API 672/672. Đã xem ảnh browser API mock desktop 1440×1000/mobile 390×844, mã dài xuống dòng và phân trang không tràn ngang. Chưa phải UAT provider thật, kiểm tra trực quan tiếng Anh/dark hoặc screen reader độc lập.
- [x] Hỏi đáp mới có thể tiếp tục sau khi OCR do worker khác hoàn tất: kiểm tra claim trả lời trước; chỉ chuẩn bị nguồn khi NOT_REQUESTED, OCR hoàn tất rồi mới claim model trả lời. Không tạo claim trả lời UNCERTAIN chỉ vì OCR còn chạy. Regression dùng context/store thật với database/provider fixture kiểm chứng không có claim trả lời lúc chờ, sau đó đúng một lần OCR và trả lời, replay không gọi thêm. 41 test context/OCR đạt; typecheck/lint đạt. Không tự mở lại các claim UNCERTAIN đã tồn tại từ luồng cũ.
- [x] Bộ ôn tập chuẩn bị OCR và kiểm tra phạm vi trang trước claim sinh nội dung. Khi OCR do worker khác giữ khóa, chưa tạo claim bộ ôn tập; người dùng có thể tiếp tục sau khi OCR READY. Replay bản đã lưu không resolve provider; claim sinh GENERATING/UNCERTAIN cũ vẫn chặn gọi lại. Test context/store mô phỏng database/provider xác nhận đúng một lượt OCR/sinh, phạm vi trang sai không để lại draft và mất phản hồi sinh vẫn giữ khóa. Không tự sửa claim cũ hoặc tự polling/retry.
- [ ] Chính sách giữ/xóa dữ liệu, khôi phục có bằng chứng và UAT provider thật. Phiên bản nguồn là ranh giới cache, thay cấu hình model không tự làm mất kết quả câu trả lời cũ.

## AI sinh đề — hoàn thiện chống tạo trùng (2026-09-08)

- [x] Tiếp tục bước `SAVING` từ bản nháp đã lưu khi người dùng thử lại cùng nội dung: controller chỉ bật `idempotentSave` cho callback lưu đề có transaction và unique generationRequestId. Không hết hạn/xóa khóa, không gọi provider lại. CAS bảo vệ cập nhật trạng thái; nhiều lần lưu chồng nhau vẫn dựa trên unique constraint/rollback để chỉ có một đề. Callback khác mặc định không được tiếp tục SAVING.
- [x] QA khôi phục lưu: 29 unit test claim và 10 MySQL persistence test đạt. Case mới mô phỏng gián đoạn sau SAVING trước transaction, chạy bốn service retry với UUID khác nhau, xác nhận một generate giả lập, một đề/câu/audit và trạng thái cuối COMPLETED. Typecheck/lint đạt. Không phải provider live; không mở retry GENERATING/UNCERTAIN hoặc sửa khóa hỏng.
- [x] Tái kiểm tra quyền lớp/khóa học trong transaction trước khi trả đề đã lưu theo generationRequestId. Người ngoài lớp, người bị gỡ phân công hoặc gửi sai courseId không lấy kết quả replay; mã chống trùng không thay thế quyền truy cập. Lớp đóng vẫn cho người còn quyền đọc kết quả đã có, không tạo đề mới.
- [x] QA quyền replay: MySQL persistence 9/9 đạt; case mới kiểm tra outsider, sai khóa học, gỡ rồi gán lại giảng viên, không thêm đề/câu hỏi sau replay. Ba bộ LearningService/claim/operations tổng 132 test đạt; typecheck/lint đạt. Không gọi provider thật; lỗi Cloudinary của lượt full suite trước chưa được xác nhận lại.
- [x] Sửa tái dùng câu ngân hàng khi lưu đề AI: hash nội dung chỉ tìm ứng viên, không đủ để kết luận trùng. Chỉ tái dùng câu PUBLISHED cùng khóa học khi khớp chính xác nội dung (kể cả hoa/thường), loại, độ khó, thứ tự lựa chọn và đáp án; không dùng câu có ảnh cho bản sinh văn bản. Database xét các phiên bản ứng viên mới nhất trước; nếu không khớp tạo câu DRAFT riêng để giữ nội dung AI đã duyệt.
- [x] QA tái dùng câu: thêm sáu test luồng service cho giống hoàn toàn/khác đáp án/thứ tự lựa chọn/loại/độ khó/hoa thường; bộ LearningService 77/77 đạt, typecheck/lint đạt. Test dùng chế độ dữ liệu bộ nhớ; nhánh truy vấn Prisma đã typecheck nhưng chưa có kiểm thử MySQL chuyên biệt cho tái dùng câu.
- [x] Kiểm chứng bổ sung trên MySQL `_test`: `ai-exam-persistence.integration.test.ts` đạt 8/8 với LearningService/transaction thật. Bảy biến thể câu hỏi (gồm câu ngân hàng có ảnh) kiểm tra đúng ID tái dùng hoặc nội dung DRAFT mới; replay cùng request không thêm đề/câu/audit. Bốn lần lưu đồng thời cùng request chỉ còn một đề, một câu và một audit; retry sau cạnh tranh trả lại đề đã lưu. Không yêu cầu mọi lời gọi cạnh tranh đều thành công. Fixture user/course/class riêng được dọn theo ID, không reset hoặc gọi provider. Typecheck/lint đạt.
- [x] Ổn định hồi quy API sau lỗi Cloudinary: test đăng ký/avatar override riêng ObjectStorageService bằng kho local thật trong thư mục tạm riêng, không đổi cấu hình ứng dụng. Vẫn kiểm tra HTTP/auth/CSRF, từ chối ảnh giả, tải lên/đọc đúng bytes/xóa avatar. Dọn thư mục chỉ sau khi xác nhận nằm trực tiếp trong temp và đúng prefix fixture. Hai test đăng ký đạt; full API 418 đạt/26 skip, typecheck/lint đạt. Số skip tăng do bộ MySQL persistence mới chỉ bật ở database `_test`; 9 test bộ này đã chạy riêng ở lượt trước. Không coi kết quả này là xác nhận Cloudinary live đã hết lỗi.
- [x] Kiểm tra cấu trúc JSON khóa khi đọc: từ chối null/array/primitive, owner/hash/trạng thái không hợp lệ, mã gốc sai kiểu/rỗng/quá dài, READY/SAVING thiếu cấu trúc nháp và COMPLETED thiếu exam ID. Trả 409 có hướng dẫn đối soát Việt–Anh, không gọi callback provider/recover/save khi đọc khóa hỏng. Đây là kiểm tra cấu trúc tối thiểu, không thay thế xác thực từng câu hỏi khi lưu hoặc đối chiếu đề đã lưu.
- [x] QA khóa hỏng: 28 unit test chống trùng đạt, MySQL 5/5 đạt; typecheck/lint đạt. Test thêm 12 dạng dữ liệu hỏng; provider/lưu đề được giả lập, không phải UAT AI live. Khôi phục có bằng chứng cho khóa hỏng vẫn chưa được mở tự động.
- [x] Tách `CLAIMED` (chưa được phép gọi provider) khỏi `GENERATING`. Lỗi tra cứu đề cũ hoặc restart ở bước chuẩn bị được tiếp tục bằng compare-and-swap; chỉ worker thắng khóa mới được gọi AI.
- [x] Giữ khóa theo người dùng/nội dung và mã yêu cầu gốc: nhiều tab/thiết bị gửi UUID khác nhau vẫn dùng chung kết quả; retry lưu sử dụng bản nháp đã cache, không sinh câu hỏi lại.
- [x] Không giải phóng `GENERATING`/`UNCERTAIN` theo thời gian; tương thích claim `GENERATING` từ phiên bản cũ. Database lỗi thì từ chối, không chuyển sang memory để lách khóa.
- [x] Kiểm thử chuyên biệt: 14 unit test; 2 integration test trên MySQL `_test` xác nhận 8 worker cạnh tranh tiếp tục một claim, một lần generate/save, phát lại sau restart và chặn UUID mới khi mất phản hồi. Provider và hàm lưu đề trong integration là giả lập; unique insert/CAS/trạng thái dùng database thật. Chỉ dọn các claim fixture của lượt test.
- [x] Hồi quy API: 335 test đạt, 11 skip ở lượt full suite; sau đó thêm hai test tương thích/lỗi database và chạy lại bộ chuyên biệt đạt 14/14. Typecheck/lint được kiểm tra riêng.
- [ ] Đối soát admin cho lần gọi đã bắt đầu nhưng chưa rõ kết quả, cùng UAT provider live, vẫn là phạm vi riêng; không tự cấp phép gọi lại hoặc xóa khóa.

## AI grading — chống tạo trùng (2026-09-08)

- [x] Đọc gợi ý đã lưu tái kiểm tra quyền, trạng thái lớp, revision và hash toàn bộ ngữ cảnh sau truy vấn trạng thái; không trả READY hoặc NOT_REQUESTED khi phân công/bài làm/rubric đổi trong lúc đọc. Năm regression test đã thất bại trước sửa và đạt sau sửa; tổng 59 test context/TXT/HTTP/store đạt, không gọi provider thật. Thông báo xung đột có bản dịch tiếng Anh; catalog API 666/666.
- [x] Lưu gợi ý chấm bằng bảng `ai_grading_suggestions`; khóa duy nhất theo giảng viên, bài nộp, hash ngữ cảnh/rubric/phiên bản và ngôn ngữ. Không dùng chung kết quả giữa các giảng viên.
- [x] Gợi ý chấm không còn fallback RAM ngay cả khi cấu hình database tắt/thiếu: find/generate trả 503 trước provider, lỗi database không chuyển sang bộ nhớ. Unit fixture mô phỏng unique insert/CAS ở biên database thay vì giữ fallback trong production. Bốn bộ kiểm thử store/context/TXT/MySQL tổng 32 đạt; typecheck/lint phần sửa đạt. Thông báo mới có bản dịch tiếng Anh.
- [x] Bổ sung 61 bản dịch thông báo API còn thiếu (2026-09-09), gồm cấu hình AI, trích xuất, hỏi đáp, rubric, quyền sửa đề và trạng thái chống trùng. `pnpm i18n:check` đạt 2.198/2.198 chuỗi frontend và 664/664 thông báo API mà bộ quét nhận diện; 7 test catalog đạt, gồm cảnh báo không tạo yêu cầu mới/không áp điểm và giới hạn 6 tệp/24 MB. Lint test đạt. Đây là độ phủ bộ quét literal, không khẳng định mọi thông báo động từ provider bên ngoài đã được dịch.
- [x] Claim database trước khi gọi provider; yêu cầu đồng thời bị chặn, kết quả `READY` được phát lại kể cả sau khi khởi động lại service hoặc provider bị tắt.
- [x] Kiểm tra đầu vào/cấu hình trước khi claim; kiểm tra quyền và nguồn trước khi đọc kết quả, tái kiểm tra sau khi sinh; không tự ghi điểm.
- [x] Lỗi chưa rõ kết quả chuyển `UNCERTAIN`; không tự retry/TTL để tránh tính phí trùng. Nếu tiến trình chết giữa chừng, claim `GENERATING` vẫn chặn gọi lại; không giả định provider chưa xử lý.
- [x] Kiểm thử: 17 unit test ở hai bộ grading assist/store; 2 integration test MySQL riêng xác nhận cạnh tranh 6 worker, phát lại sau khi tạo lại service và giữ trạng thái không rõ kết quả. Provider trong các test là giả lập, không phải UAT AI live.
- [x] Migration bổ sung đã áp dụng cho database local và database `_test`; không reset dữ liệu.
- [x] Nối HTTP cho gợi ý chấm: POST/GET `instructor/assignment-submissions/:submissionId/ai-suggestion`, chỉ nhận phiên bản bài nộp và VI/EN/BILINGUAL; GET không sinh AI, response `no-store`, quyền `exam:manage` và kiểm tra phân công trong service. Test HTTP dùng guard/validation thật, mock biên auth/service; không thay thế UAT live.
- [x] Cấu hình admin có tác vụ riêng “Gợi ý chấm bài”, hỗ trợ Gemini/OpenAI/NIM/Custom, không yêu cầu Gemini phụ cho Custom văn bản. Có mô tả giới hạn, bản dịch Anh và kiểm thử lưu/khôi phục/lỗi/đổi provider. Frontend 65 test đạt; ảnh trình duyệt mock đã xem ở desktop 1440×1000 và mobile 390×844.
- [x] UI giảng viên trong cửa sổ chấm bài: kiểm tra gợi ý đã lưu bằng GET, chỉ tạo có chủ ý khi chưa có yêu cầu; xem điểm/lý do/trích dẫn, xác nhận trước khi thay nội dung form. Việc lưu điểm vẫn là thao tác thủ công riêng. Timeout buộc đối soát GET, không tự POST lại; không hiện gợi ý cũ khi đổi bài/phiên bản/ngôn ngữ/danh tính.
- [x] Chấm AI văn bản: 11 test component riêng, tổng 76 test frontend đạt; typecheck/lint và catalog 2.145 chuỗi đạt. Browser mock xác nhận copy điểm/phản hồi và modal mobile nằm trong viewport, không tràn ngang. Review độc lập `ship` ở phạm vi giao diện đã xem, không phải UAT provider live; ghi chú tại `docs/ai-grading-review.md`.
- [x] Mở rộng gợi ý chấm cho PDF/PNG/JPEG/WebP qua pipeline OCR bền vững và đối chiếu đúng revision/checksum/metadata tệp. Bài hỗn hợp văn bản/TXT/PDF/ảnh phải đọc đủ mọi nguồn; không âm thầm bỏ tệp không hỗ trợ.
- [x] Hỗ trợ DOCX cho gợi ý chấm bằng bộ đọc cục bộ, giữ thứ tự văn bản/bảng và không tiêu thụ lượt OCR. Kiểm tra ZIP directory trước giải nén: tối đa 2.048 entry, 8 MB/entry và 32 MB tổng nở; vẫn giữ giới hạn upload 12 MB, checksum/revision và giới hạn 20.000 ký tự của toàn bài. Word `.doc` nhị phân cũ vẫn bị chặn rõ ràng và chuyển sang chấm thủ công.
- [x] Điểm nối nội bộ `gradingAiContext` nhận reader PDF/PNG/JPEG/WebP: chỉ chuyển bytes sau đối chiếu checksum/metadata/revision, ghép đủ mọi tệp và phần nhập trực tiếp, tái kiểm tra toàn bộ nguồn sau đọc. Metadata MIME/phần mở rộng phải khớp; tối đa 5 tệp, 12 MB/tệp và 24 MB tổng; văn bản vẫn giới hạn 20.000 ký tự, không cắt/bỏ nguồn. Reader hiện đã được API chấm truyền vào; Word vẫn bị chặn.
- [x] QA điểm nối nguồn OCR: 41 test context/chấm/TXT/source đạt, gồm bài hỗn hợp, bytes sai, metadata sai, dung lượng vượt, văn bản trích xuất rỗng/quá dài/control bytes và revision đổi trong reader. Typecheck/lint đạt; callback trích xuất trong test là giả lập, chưa gọi provider thật.
- [x] `AiGradingDocumentReader` đọc/lưu OCR bền vững theo người chấm/bài nộp/revision/tệp/checksum/tên/MIME, kiểm tra bytes trước cache. Chế độ mặc định chỉ đọc, không claim/resolve model/gọi OCR; tạo có chủ ý kiểm tra cấu hình chấm + trích xuất trước claim. READY dùng lại khi provider tắt; UNCERTAIN không retry. Văn bản ghép toàn bộ trang không bị cắt, vượt giới hạn chấm bị từ chối nhưng giữ cache OCR. Reader đã được nối vào API chấm; kiểm tra rubric diễn ra trước OCR có phí.
- [x] Nối reader vào `AiGradingAssistService`: suggest được tạo OCR có chủ ý, inspect và lần kiểm tra nguồn cuối chỉ đọc cache. PDF/PNG/JPEG/WebP có thể đi qua API chấm, bao gồm bài hỗn hợp với TXT; Word vẫn bị chặn. Kiểm tra ngôn ngữ và rubric gốc trước OCR có phí; schema dùng chung với đầu vào chấm, không để bước sửa ID legacy che rubric trùng. Không thay quy tắc chấm tay. Inspect khi chưa có bản OCR trả `NOT_REQUESTED` mà không resolve model/gọi provider; trạng thái OCR `GENERATING`/`UNCERTAIN` vẫn chặn tạo lại để tránh tính phí trùng.
- [x] Mở giao diện chấm PDF/ảnh: giảng viên phải chủ động kiểm tra trạng thái rồi mới thấy nút tạo; giao diện cảnh báo phí OCR + chấm, sai số OCR và buộc mở nguồn/đánh dấu đã đối chiếu trước khi copy gợi ý. TXT giữ thông báo đối chiếu riêng, không bị gắn nhãn OCR. Yêu cầu POST chỉ chứa revision/ngôn ngữ, model vẫn do admin cấu hình.
- [x] QA giao diện chấm OCR: frontend 126/126 test đạt; 32 test backend reader/TXT đạt; frontend typecheck/lint và catalog 2.217/2.217 frontend, 675/675 API đạt. Browser API mock xác nhận GET `NOT_REQUESTED` → POST tạo, body không mang model/nội dung, review gate khóa áp dụng; ảnh desktop 1440×1000 và mobile 390×844 đã xem, modal không tràn ngang và console không có lỗi. Chưa phải UAT provider live; chất lượng OCR/chấm thực tế vẫn cần kiểm thử với tài liệu thật.
- [x] QA chấm DOCX: 35 test backend reader/luồng chấm đạt, gồm đoạn văn + bảng, DOCX hỏng, archive nở quá giới hạn, status/replay và xác nhận chỉ resolve model chấm một lần, không gọi model OCR. Frontend 128/128 test đạt; typecheck/lint và catalog 2.219/2.219 frontend, 679/679 API đạt. Browser API mock xác nhận cảnh báo “không dùng lượt OCR”, body POST tối thiểu, review gate và modal desktop/mobile không tràn ngang; console không lỗi. Chưa kiểm thử độc lập mọi cấu trúc OfficeMath, textbox hoặc embedded object; giao diện yêu cầu đối chiếu nguồn trước dùng.
- [x] QA nối chấm OCR: 81 test HTTP/context/TXT/grading đạt; bài hỗn hợp chạy đúng một OCR + một lượt chấm rồi replay/inspect khi provider tắt, rubric rỗng/trùng và ngôn ngữ sai chặn trước tải tệp/model/claim. Full API 602 đạt/38 skip; typecheck/lint và catalog đạt. Provider/database trong kiểm thử luồng này là fixture, chưa UAT provider thật.
- [x] Chuẩn bị nguồn tệp bài nộp: đường đọc dùng chung đối chiếu SHA-256/kích thước, kiểm tra lại quyền và metadata/phiên bản sau khi tải; hỗ trợ ghim revision cho caller nội bộ. 15 test nguồn xác nhận từ chối tệp sai bytes/metadata, bị gỡ và mất quyền trong khi tải. Đây chưa phải pipeline trích xuất/chấm tệp bằng AI.
- [x] Backend chấm TXT UTF-8: đọc đủ mọi tệp và phần nhập trực tiếp, giữ snapshot nguồn/checksum cùng gợi ý. Tối đa 80.000 byte/tệp và 20.000 ký tự toàn bài (tính cả dấu ngăn); từ chối binary, lỗi UTF-8, nguồn rỗng, định dạng hỗn hợp không hỗ trợ, không tự cắt. Trích dẫn phải thuộc nguyên vẹn một nguồn. Đối chiếu toàn bộ nguồn lần cuối trước AI; test đổi metadata tệp trước khi đang đọc tệp sau đã red → green.
- [x] Nối frontend chấm TXT: hỗ trợ bài chỉ có tệp và bài gồm văn bản + TXT; mở đầy đủ snapshot từng nguồn, chỉ rõ nguồn của trích dẫn, giữ nguyên ngôn ngữ tên tệp/bài làm. Kiểm tra thiếu/trùng/sai nguồn, giới hạn tệp và trích dẫn không được nối qua hai nguồn. Chỉ copy gợi ý sau xác nhận, không tự lưu điểm. Cập nhật mô tả cấu hình admin và tiếng Anh.
- [x] QA frontend TXT: 91 test đạt; typecheck/lint đạt; catalog 2.150 chuỗi không thiếu bản dịch. Browser API mock xác nhận nguồn/trích dẫn và copy điểm/phản hồi ở desktop 1440×1000, mobile 390×844; modal mobile x=16…374, y≈34…810, không tràn ngang. Đây chưa phải UAT provider live hoặc chứng minh chất lượng chấm AI.
- [x] Backend đọc hàng đợi đối soát chấm AI: `GET /admin/ai-operations/grading`, chỉ `SYSTEM_ADMIN` có `system:configure`; mặc định `GENERATING`/`UNCERTAIN`, lọc riêng `READY` được. Phân trang keyset theo createdAt/ID, mặc định 20/tối đa 50, response `no-store`. Chỉ select metadata, không tải JSON kết quả, bài làm, điểm hoặc hash; không có route reset/retry/xóa. Database bị tắt trả 503 thay vì danh sách rỗng giả.
- [x] Kiểm thử đối soát: 17 ca HTTP dùng route/guard/DTO/service thật, mock authentication/database; kiểm tra metadata tối thiểu, phân trang, mốc bị xóa, bộ lọc sai/extra, admin thiếu quyền và giảng viên có quyền cấu hình vẫn bị chặn. API full suite 354 đạt/11 skip; typecheck và lint phần mới đạt. Chưa phải UAT dữ liệu/provider live.
- [x] MySQL đối soát: bộ integration grading đạt 4/4, gồm giữ claim/phát lại, UNCERTAIN, phân trang các row cùng timestamp qua thay đổi trạng thái, cursor bị xóa và chỉ trả metadata trong khi JSON riêng vẫn còn lưu. Migration `20260908060000_ai_grading_operations_index` bổ sung index state/created_at/id đã áp dụng local + `_test`, không reset dữ liệu; kiểm thử xác nhận index có trong MySQL. Chưa benchmark tải lớn và không khẳng định index loại bỏ mọi filesort khi lọc nhiều trạng thái.
- [x] Giao diện admin hàng đợi chấm AI ở Cấu hình → AI và quét đề: chọn bộ lọc, tải có chủ ý, xem mã tác vụ/giảng viên/bài nộp và thời điểm, phân trang trước/sau. Không đọc bài làm/điểm hoặc cho retry/xóa khóa. Đổi bộ lọc và lỗi xóa kết quả cũ; timeout hướng dẫn tải lại, không tự polling; rời panel hủy request đọc. Chỉ SYSTEM_ADMIN có quyền cấu hình mới thấy panel.
- [x] QA panel đối soát: 9 test component, frontend tổng 100 đạt; typecheck/lint và catalog 2.170 chuỗi đạt. Browser mock desktop/mobile; bộ lọc mobile xếp dọc để không cắt nhãn. Detector không có finding, reviewer độc lập `ship` trong phạm vi ảnh/code đã xem; chưa kiểm tra AI live, giao diện tiếng Anh/dark hoặc screen reader độc lập.
- [x] Backend đối soát bộ ôn tập: `GET /admin/ai-operations/study`, dùng cùng điều kiện admin/quyền cấu hình, bộ lọc và phân trang keyset như chấm bài. Chỉ select ID/người tạo/tài liệu/phiên bản nguồn/trạng thái/thời gian, không tải options/result/editedResult/publishedResult. Mốc phân trang chỉ tra trong bảng bộ ôn tập, không nhận cursor hàng đợi khác.
- [x] QA đối soát học liệu: 34 HTTP test chung hai route đạt; bộ study MySQL 4/4 đạt, gồm metadata-only, cùng timestamp, đổi trạng thái cursor và kiểm tra index. Migration `20260908070000_ai_study_operations_index` đã áp dụng local + test không reset. API full 371 đạt/14 skip; typecheck/lint phần thay đổi đạt. Không gọi AI live.
- [x] Nối bộ ôn tập vào panel đối soát admin: chọn loại tác vụ chấm bài hoặc tóm tắt/flashcard; hiển thị mã người tạo/tài liệu/phiên bản nguồn thay vì mã bài nộp/ngôn ngữ. Đổi loại remount panel, hủy request cũ và đặt lại bộ lọc/cursor; không tự fetch, không mang phản hồi muộn sang hàng đợi mới.
- [x] QA chuyển loại hàng đợi: 11 test component, frontend tổng 102 đạt; typecheck/lint đạt; catalog 2.174 chuỗi không thiếu dịch. Browser mock desktop 1440×1000 và mobile 390×844 xác nhận metadata học liệu, phiên bản và phân trang; không phải UAT provider live. Giữ hệ giao diện cũ theo impeccable, không thay DESIGN.md.
- [x] Backend đối soát sinh đề: `GET /admin/ai-operations/exams`, chỉ admin có quyền cấu hình; hỗ trợ CLAIMED/GENERATING/READY/SAVING/COMPLETED/UNCERTAIN, mặc định không lấy COMPLETED. SQL tham số hóa chỉ chiếu metadata của request gốc có content binding khớp owner/hash; UUID retry và binding không thành hàng tác vụ. Không tải prepared/result hoặc đề/đáp án vào API. Phân trang theo thời điểm tạo claim + key, cursor alias/không tồn tại bị chặn.
- [x] Kiểm thử sinh đề: 21 HTTP test route/DTO/guard/service thật với biên SQL mock; bộ MySQL sinh đề 3/3 đạt, gồm loại alias, đổi trạng thái cursor, metadata không lộ JSON riêng và cursor chứa chuỗi SQL không mở rộng truy vấn. API full 392 đạt/15 skip; typecheck/lint phần mới đạt; không gọi provider thật.
- [x] Nối giao diện hàng đợi sinh đề vào Cấu hình → AI và quét đề: chọn Sinh đề thi, lọc đủ sáu trạng thái, phân biệt bản nháp AI với đề đã lưu; hiển thị phiên bản tác vụ, mã người tạo và thời gian. Chỉ đọc metadata, không có nút xóa khóa/gọi lại AI. Nêu rõ phạm vi request gốc có liên kết hợp lệ.
- [x] QA giao diện sinh đề: 12 test component đối soát, tổng 103 test frontend đạt; typecheck/lint đạt. Catalog 2.183 chuỗi không thiếu bản dịch. Đã xem ảnh browser mock tiếng Việt giao diện sáng ở desktop 1440×1000 và mobile 390×844, gồm phần phân trang cuối panel. Chưa phải UAT provider live hoặc kiểm tra trực quan tiếng Anh/dark.
- [x] Backend đối soát claim thiếu binding: `GET /admin/ai-operations/exams?scope=unlinked`; mặc định `scope=canonical` giữ tương thích. Nhóm unlinked là request không có binding khớp owner/hash, không nhầm UUID retry đã liên kết thành claim mồ côi. Chỉ đọc metadata, giữ quyền admin/no-store/bộ lọc/phân trang. Cursor khác scope hoặc đã chuyển sang có binding trả 400 để tải lại. Có thể thấy trạng thái chuẩn bị đang diễn ra, không khẳng định mọi row đều lỗi.
- [x] QA scope: 26 HTTP test đạt; MySQL sinh đề 4/4 đạt, gồm hai claim thiếu binding cùng timestamp, alias mới hơn không lọt danh sách, không lộ/đổi prepared JSON, chuyển scope sau khi binding xuất hiện và không tăng số lần gọi generator giả lập. Typecheck/lint phần thay đổi đạt. Không reset database hoặc gọi provider thật.
- [x] Giao diện bộ lọc thiếu binding: chọn phạm vi chỉ trong hàng đợi sinh đề, truyền `scope=unlinked` khi tải có chủ ý; đổi phạm vi xóa dữ liệu/cursor/lỗi cũ, giữ bộ lọc trạng thái. Khóa bộ lọc khi đang tải; đổi loại tác vụ đặt lại scope. Mô tả rõ khóa đang chuẩn bị không nhất thiết là lỗi và hướng dẫn tải lại khi liên kết thay đổi.
- [x] QA bộ lọc scope: 13 test component đối soát, tổng 104 test frontend đạt; typecheck/lint đạt; catalog 2.187 chuỗi không thiếu dịch. Browser mock tiếng Việt/giao diện sáng desktop 1440×1000 và mobile 390×844 đã xem bộ lọc, nội dung và chân phân trang. Không gọi AI thật; không khẳng định đã UAT tiếng Anh/dark/screen reader.
- [x] Backend `scope=broken` liệt kê request bị ảnh hưởng bởi binding khớp owner/hash nhưng đích không hợp lệ: canonicalRequestId thiếu/rỗng/không phải chuỗi, request đích mất, sai owner/hash hoặc trạng thái đích không thuộc workflow. Có thể gồm nhiều mã retry cùng bị ảnh hưởng, không coi số hàng là số lần gọi AI. Giữ metadata-only, quyền admin, no-store và phân trang; không tự sửa liên kết.
- [x] QA liên kết hỏng: 27 HTTP test đạt; bộ MySQL sinh đề 5/5 đạt, gồm bảy loại lỗi binding/đích, loại retry có đích hợp lệ, phân trang và cursor khác scope, so sánh snapshot xác nhận đọc không đổi dữ liệu. Typecheck/lint đạt. Provider không được gọi trong test đối soát.
- [x] Giao diện `scope=broken`: thêm lựa chọn “Liên kết hỏng”, mô tả rõ request bị ảnh hưởng có thể gồm nhiều UUID retry và số hàng không phải số lần gọi AI. Tái sử dụng cơ chế tải có chủ ý, khóa bộ lọc lúc đọc, xóa dữ liệu/cursor khi đổi phạm vi; không thêm thao tác sửa/xóa/gọi lại.
- [x] QA giao diện broken: 14 test component đối soát, tổng 105 test frontend đạt, typecheck/lint đạt, catalog 2.189 chuỗi không thiếu dịch. Đã xem browser mock tiếng Việt/giao diện sáng desktop 1440×1000 và mobile 390×844, gồm chân phân trang. Chưa phải UAT provider thật, giao diện tiếng Anh/dark hoặc screen reader.
- [x] Đánh giá và tối ưu truy vấn mặc định claim sinh đề trên MySQL `_test`: fixture 20.000 request + 20.000 binding cho baseline khoảng 213 ms; đổi sang quét binding rồi tra claim bằng PRIMARY KEY giảm còn khoảng 128 ms trên cùng máy/lượt đo. `EXPLAIN` chuyển target claim từ range scan ~20.000 hàng sang `eq_ref`, một hàng mỗi binding; chi phí ước lượng giảm từ ~77 triệu xuống ~30 nghìn. `DISTINCT` giữ đúng một tác vụ khi dữ liệu legacy có binding trùng. Fixture có owner riêng và được dọn sau mỗi lượt; không thêm index không được optimizer sử dụng. Đây là phép đo tổng hợp, không phải SLA production; scope `unlinked`/`broken` vẫn là truy vấn điều tra ngoại lệ và cần theo dõi khi dữ liệu thực tăng.
- [x] Đã bỏ nhánh memory khỏi `AiGenerationRequestService`, Prisma là dependency bắt buộc. Thiếu/tắt database trả 503 trước claim/recover/generate/save; không sinh AI bằng khóa chỉ sống trong một process. Hai test mới xác nhận nhiều instance/UUID không lách được điều kiện này; 16 unit test và 4 MySQL integration test đạt, typecheck/lint đạt. Thông báo có bản dịch tiếng Anh. Đây là sửa bổ sung cho chế độ database bị tắt; kiểm thử trước đó chỉ bao phủ lỗi kết nối khi database đang bật.
- [ ] Quy trình khôi phục có bằng chứng và kiểm thử provider live; chưa cho tự xóa claim hoặc gọi lại mù.

## L. Trung tâm song ngữ Việt–Anh

| Mã | Trạng thái | Kết quả triển khai và nghiệm thu |
|---|---|---|
| I18N-01 — nền tảng locale | Done | Provider toàn ứng dụng hỗ trợ `vi-VN`/`en-US`, lưu lựa chọn ở localStorage + cookie, đặt `html[lang]` và metadata đúng locale, chuyển hai chiều không mất chuỗi nguồn. |
| I18N-02 — điểm đổi ngôn ngữ | Done | Nút VI/EN có nhãn trợ năng ở đăng nhập, đăng ký, khôi phục/xác minh tài khoản và header workspace; hồ sơ tài khoản đổi locale tức thời và lưu về server. |
| I18N-03 — phủ giao diện | Done | Catalog phủ 1.976 chuỗi tĩnh/template frontend; thuật ngữ học vụ cốt lõi được biên tập riêng, chuỗi có dữ liệu động chỉ dịch khi khớp toàn bộ template để không sửa dữ liệu người dùng. |
| I18N-04 — API và định dạng | Done | Web gửi `Accept-Language`; API trả tiếng Anh cho 553 lỗi nghiệp vụ đã kiểm kê; ngày giờ/số và cửa sổ xem tài liệu dùng locale hiện hành. |
| I18N-05 — quality gate | Done | `pnpm i18n:check` chặn chuỗi chưa dịch; web 29/29 test, API 133 test đạt + 4 integration test bỏ qua theo cấu hình; typecheck/lint sạch. |
| I18N-06 — responsive review | Done | Playwright và kiểm tra ảnh thật đạt ở desktop 1440×900, mobile 390×844; không tràn ngang, tiếng Anh không phá bố cục và chuyển EN → VI thành công. |

**Quy tắc duy trì:** mọi chuỗi nghiệp vụ mới phải được thêm vào catalog cùng PR; lỗi API mới phải qua coverage; nội dung do người dùng tạo, tên khóa học/lớp/tệp và dữ liệu nhập không được tự động dịch.

### K.5. Hoàn tất backlog nội bộ còn lại

| Task Sheet | Trạng thái | Bằng chứng nghiệm thu |
|---|---|---|
| TASK-BE-054 — background worker | Done | Backup, export và retention được enqueue DB; worker claim nguyên tử, lease 10 phút, tiến độ, tối đa 5 lần thử với backoff, audit và cảnh báo terminal. Integration kiểm chứng export `PENDING → COMPLETED`, checksum object và đúng một attempt. |
| TASK-BE-057 — invitation + multi-role | Done | Tạo tài khoản không mật khẩu sinh token kích hoạt 7 ngày, trạng thái `PENDING_VERIFICATION`, gửi email khi Resend sẵn sàng; kích hoạt qua reset password. Một tài khoản giữ nhiều `roleCodes`; impact/update không làm mất vai trò ngoài ý muốn. |
| TASK-BE-058 — course/class rules | Done | Không archive khóa học còn lớp `ACTIVE`; gán giảng viên chỉ chặn khi buổi học thực sự giao nhau, không chặn vì toàn khoảng ngày của hai lớp trùng nhau. Có regression test cho cả hai nhánh. |
| TASK-BE-060 — runtime config | Done | Maintenance guard chặn mutation với mã lỗi ổn định; moderation dùng cấu hình/policy đang hiệu lực; mẫu thông báo published được dùng lúc chạy; live session chỉ provision provider enabled + healthy và fallback Jitsi thật. |
| TASK-BA-002 — decisions/refinement | Done | DEC-01…13, ma trận phạm vi, trạng thái Deferred/Blocked và tiêu chí nghiệm thu đã ghi rõ; các quyết định kỹ thuật đã được triển khai, các phụ thuộc sản phẩm/provider bên ngoài không bị báo hoàn tất giả. |
