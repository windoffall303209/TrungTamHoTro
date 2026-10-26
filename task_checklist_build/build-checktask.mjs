import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/WIND-OF-FALL/Documents/Project/TestDoAn/outputs/checktask_he_thong_trung_tam_20261025";
const outputPath = `${outputDir}/Checktask_he_thong_trung_tam.xlsx`;
const previewDir = `${outputDir}/qa_previews`;
const fontName = "Arial";
const headers = [
  "Done?",
  "Task ID",
  "Function ID",
  "Hạng mục theo dõi",
  "Yêu cầu / tiêu chí hoàn tất",
  "Priority",
  "Status",
  "Owner",
  "Mốc / Sprint",
  "Ngày cập nhật",
  "Phiên bản / Commit",
  "Đã sửa / thay đổi",
  "Lưu ý / Blocker",
];

const roles = [
  {
    id: "USR-01",
    name: "Quản trị hệ thống",
    detail: "Quản lý người dùng, vai trò, phân quyền, cấu hình, tích hợp và công cụ AI.",
  },
  {
    id: "USR-02",
    name: "Quản lý trung tâm",
    detail: "Điều hành khóa học, lớp, phân công giảng viên, ghi danh và vòng đời lớp.",
  },
  {
    id: "USR-03",
    name: "Giảng viên",
    detail: "Tổ chức học liệu, câu hỏi, đề thi, bài tập, chấm bài và diễn đàn.",
  },
  {
    id: "USR-04",
    name: "Học viên",
    detail: "Tham gia lớp, sử dụng học liệu, làm bài, xem kết quả, trao đổi và gửi yêu cầu hỗ trợ.",
  },
];

const sections = [
  {
    number: "2.1",
    title: "Xác thực và quản lý tài khoản",
    sheet: "03 2.1 Tài khoản",
    items: [
      ["2.1.1", "Tạo tài khoản", "Quản trị hệ thống", "Tạo tài khoản trạng thái chưa xác minh sau khi kiểm tra dữ liệu và username duy nhất.", "Quản trị nhập thông tin; hệ thống kiểm tra hợp lệ, kiểm tra username và tạo tài khoản chưa xác minh.", "Username đã tồn tại: báo lỗi và gợi ý đăng nhập hoặc khôi phục mật khẩu.", "Username phải duy nhất; tài khoản mới sẵn sàng đăng nhập ở trạng thái chưa xác minh.", "P1"],
      ["2.1.2", "Đăng nhập vào hệ thống", "Người dùng đã có tài khoản", "Xác thực danh tính và mở phiên làm việc an toàn, đúng giao diện theo vai trò.", "Nhập tài khoản/mật khẩu; xác thực; qua bước xác thực tài khoản; tạo phiên phía máy chủ; trả giao diện theo quyền.", "Có 2FA thì yêu cầu OTP; sai thông tin không lộ nguyên nhân; tài khoản khóa bị từ chối và hướng dẫn liên hệ quản trị.", "Chỉ tài khoản tồn tại, đã xác minh và chưa bị khóa được đăng nhập; quyền phiên đọc từ cơ sở dữ liệu.", "P1"],
      ["2.1.3", "Khôi phục và đổi mật khẩu", "Người dùng đã có tài khoản", "Khôi phục truy cập bằng liên kết email có hạn hoặc đổi mật khẩu trực tiếp khi đã đăng nhập.", "Nhập email; gửi liên kết đặt lại; nhập và xác nhận mật khẩu mới; cập nhật mật khẩu và mời đăng nhập lại.", "Liên kết hết hạn bị từ chối và yêu cầu gửi lại; người dùng đang đăng nhập có thể đổi trực tiếp trong hồ sơ.", "Tài khoản phải tồn tại và có email hợp lệ; các phiên cũ có thể phải đăng nhập lại theo chính sách.", "P1"],
      ["2.1.4", "Quản lý phiên và hồ sơ cá nhân", "Người dùng đã đăng nhập", "Xem, thu hồi phiên hoạt động và cập nhật hồ sơ, ảnh đại diện trong phiên hợp lệ.", "Mở danh sách phiên; thu hồi một hoặc tất cả phiên khác; cập nhật hồ sơ; tải lên/xóa ảnh; lưu và áp dụng ngay.", "Thao tác nhạy cảm có thể yêu cầu thử thách email; người dùng luôn có thể đăng xuất phiên hiện tại.", "Danh sách phiên và hồ sơ phải phản ánh đúng thao tác vừa thực hiện.", "P1"],
    ],
  },
  {
    number: "2.2",
    title: "Quản trị người dùng và phân quyền",
    sheet: "04 2.2 Phân quyền",
    items: [
      ["2.2.1", "Tra cứu và quản lý tài khoản người dùng", "Quản trị hệ thống", "Tìm kiếm, tạo, sửa, khóa hoặc mở khóa tài khoản, có nhật ký danh tính.", "Hiển thị danh sách phân trang và tổng số; tìm kiếm không phân biệt hoa thường; tạo, sửa, khóa/mở khóa; ghi nhật ký.", "Tham số trang hoặc kích thước trang vượt giới hạn: báo lỗi; tạo trùng email: từ chối và nêu lý do.", "Kích thước trang tối đa 50; từ khóa tối đa 200 ký tự; nhật ký phải ghi nhận thay đổi.", "P1"],
      ["2.2.2", "Điều chỉnh vai trò và phân quyền", "Quản trị hệ thống", "Đổi vai trò hoặc ma trận quyền an toàn, có xem trước tác động và nhật ký.", "Chọn tài khoản; xem trước quyền thay đổi và việc cần bàn giao; xác nhận cập nhật vai trò/quyền; ghi nhật ký.", "Tài khoản còn công việc chưa bàn giao: cảnh báo trước khi cho phép đổi quyền.", "Quản trị phải có quyền quản lý vai trò/quyền; quyền thực tế của phiên được đọc lại từ cơ sở dữ liệu.", "P1"],
    ],
  },
  {
    number: "2.3",
    title: "Khóa học, lớp và ghi danh",
    sheet: "05 2.3 Khóa học lớp",
    items: [
      ["2.3.1", "Quản lý khóa học theo phiên bản", "Quản lý trung tâm", "Tạo, cập nhật, phát hành và lưu trữ khóa học với lịch sử phiên bản.", "Tạo khóa học; biên soạn nội dung; phát hành để mở lớp; lưu phiên bản cho thay đổi lớn; lưu trữ khóa học không dùng.", "Có thể xem danh sách phiên bản của bất kỳ khóa học nào.", "Trạng thái khóa học phải là nháp, đã phát hành hoặc đã lưu trữ; lịch sử phiên bản đầy đủ.", "P1"],
      ["2.3.2", "Tạo lớp và quản lý vòng đời lớp", "Quản lý trung tâm", "Mở, kích hoạt, đóng và mở lại lớp theo điều kiện nghiệp vụ.", "Tạo lớp từ khóa học đã phát hành; cấu hình; kích hoạt; kiểm tra sẵn sàng đóng; đóng lớp và chuyển không gian liên quan sang chỉ đọc.", "Chưa sẵn sàng đóng: liệt kê điểm vướng và dừng; có thể mở lại lớp khi điều kiện cho phép.", "Lớp phải có trạng thái nháp, đang hoạt động hoặc đã đóng; trạng thái chi phối quyền giảng viên/học viên.", "P1"],
      ["2.3.3", "Phân công giảng viên cho lớp", "Quản lý trung tâm", "Gán giảng viên chính/đồng giảng viên, chuyển giao và gỡ phân công có kiểm soát.", "Chọn lớp; gán giảng viên; kiểm tra trùng lịch; chuyển giảng viên chính hoặc gỡ giảng viên; lưu lịch sử phân công.", "Phát hiện trùng lịch: cảnh báo và không cho phép phân công xung đột.", "Lớp phải tồn tại và giảng viên phù hợp trong hệ thống; lịch sử phân công truy vết được.", "P1"],
      ["2.3.4", "Ghi danh học viên vào lớp", "Quản lý trung tâm", "Ghi danh thủ công/hàng loạt, kiểm soát sĩ số và bảo toàn dữ liệu học tập khi gỡ/ghi danh lại.", "Chọn lớp; nhập thủ công hoặc hàng loạt; kiểm tra sĩ số/điều kiện; gỡ hoặc ghi danh lại; lưu lịch sử.", "Lớp đủ sĩ số: từ chối và thông báo; hỗ trợ ghi danh muộn theo quy tắc lớp.", "Roster và lịch sử ghi danh phải phản ánh chính xác thay đổi.", "P1"],
    ],
  },
  {
    number: "2.4",
    title: "Học liệu",
    sheet: "06 2.4 Học liệu",
    items: [
      ["2.4.1", "Tải lên và phiên bản hóa học liệu", "Giảng viên", "Tải tệp học liệu, kiểm tra an toàn và giữ lịch sử phiên bản.", "Chọn lớp; tải tệp; kiểm tra kiểu tệp, kích thước, checksum, quyền; lưu kho và tạo phiên bản; tải phiên bản mới khi cập nhật.", "Sai định dạng/quá dung lượng: từ chối; quá tải upload đồng thời: trả 429 để thử lại.", "Ghi tệp tạm và kiểm tra checksum trước khi tải xuống; lịch sử phiên bản phải đầy đủ.", "P1"],
      ["2.4.2", "Tìm kiếm, truy cập và tải xuống học liệu", "Giảng viên và học viên", "Tìm và tải đúng phiên bản học liệu đúng quyền bằng liên kết có thời hạn.", "Mở kho; phân trang; tìm kiếm/lọc; chọn phiên bản; kiểm tra quyền; cấp liên kết có hạn; ghi nhật ký truy cập.", "Mất quyền: từ chối cấp liên kết; liên kết hết hạn: phải yêu cầu lại.", "Danh sách phân trang phía máy chủ; lọc/đếm tổng qua tìm kiếm chuyên dụng.", "P1"],
      ["2.4.3", "Kiểm duyệt học liệu", "Quản lý trung tâm", "Duyệt, ẩn, cách ly hoặc thu hồi học liệu và lưu lịch sử kiểm duyệt.", "Mở danh sách cần kiểm duyệt; xem nội dung; duyệt/ẩn/cách ly/thu hồi; lưu quyết định vào lịch sử.", "Giảng viên có thể sửa nội dung để khắc phục rồi gửi duyệt lại.", "Học viên chỉ nhìn thấy học liệu đã được duyệt.", "P1"],
    ],
  },
  {
    number: "2.5",
    title: "Ngân hàng câu hỏi và đề thi",
    sheet: "07 2.5 Đề thi",
    items: [
      ["2.5.1", "Xây dựng ngân hàng câu hỏi", "Giảng viên", "Tạo, cập nhật, phát hành và phiên bản hóa nhiều loại câu hỏi, có hỗ trợ nhập/quét AI.", "Tạo câu hỏi; chọn loại; nhập nội dung/phương án/ảnh; phát hành; phiên bản hóa; nhập hàng loạt hoặc quét ảnh AI.", "Quản trị có thể rà soát ngân hàng dùng chung; khi quét ảnh chọn provider và model phù hợp.", "Hỗ trợ một/nhiều đáp án, đúng sai, điền ngắn, tự luận; giữ lịch sử phiên bản câu hỏi và ảnh.", "P1"],
      ["2.5.2", "Soạn đề và sinh đề bằng AI", "Giảng viên", "Soạn đề thủ công hoặc nhờ AI sinh đề, sau đó chỉnh sửa trước khi duyệt.", "Tạo đề nháp; cấu hình số lượng/ma trận/độ khó/ngôn ngữ/ngữ cảnh; AI sinh gợi ý; kiểm tra ma trận, đáp án, trùng; giảng viên sửa.", "Thiếu tài liệu phù hợp có thể tìm Internet nếu cấu hình cho phép; câu trùng/sai cấu trúc phải cảnh báo.", "Đề sau bước này ở trạng thái nháp, sẵn sàng gửi duyệt.", "P1"],
      ["2.5.3", "Duyệt và phát hành đề thi", "Giảng viên và quản lý trung tâm", "Duyệt nhiều bước trước khi phát hành đề thi, có lịch sử phê duyệt.", "Giảng viên gửi duyệt; quản lý xem trước và duyệt/trả lại kèm lý do; giảng viên phát hành; lưu lịch sử.", "Đề bị trả lại: giảng viên chỉnh sửa và gửi duyệt lại.", "Trạng thái phải đúng: nháp, chờ duyệt, đã phát hành hoặc đã đóng.", "P1"],
      ["2.5.4", "Học viên làm bài thi", "Học viên", "Làm bài an toàn, tự lưu và tự nộp theo đồng hồ máy chủ.", "Bắt đầu lượt thi; tải câu hỏi; trả lời và tự lưu định kỳ; nộp hoặc tự nộp khi hết giờ; chuyển sang chấm.", "Nộp nhiều lần không tạo bản nộp trùng; mất kết nối tạm thời vẫn giữ đáp án đã tự lưu.", "Thời gian dùng đồng hồ máy chủ; lượt thi sau nộp là đã nộp, chờ chấm.", "P1"],
      ["2.5.5", "Xem kết quả và yêu cầu phúc khảo", "Học viên và giảng viên", "Xem điểm, gửi phúc khảo, xử lý và ghi lịch sử thay đổi điểm.", "Học viên xem kết quả; gửi phúc khảo kèm lý do; giảng viên nhận xử lý, xem xét bài, giải quyết và cập nhật điểm khi có thay đổi.", "Không đổi kết quả: đóng yêu cầu kèm giải thích.", "Kết quả cuối cùng, lịch sử phúc khảo và sửa điểm phải lưu được.", "P1"],
    ],
  },
  {
    number: "2.6",
    title: "Bài tập, nộp bài và chấm điểm",
    sheet: "08 2.6 Bài tập",
    items: [
      ["2.6.1", "Tạo và quản lý bài tập", "Giảng viên", "Tạo, công bố, gia hạn và đóng bài tập cùng rubric chấm, có lịch sử.", "Tạo bài tập, mô tả yêu cầu và rubric; công bố; gia hạn/đóng khi cần; lưu mọi thay đổi.", "Có thể sửa bài tập ở trạng thái nháp trước khi công bố.", "Trạng thái đúng: nháp, đã công bố hoặc đã đóng; lịch sử đầy đủ.", "P1"],
      ["2.6.2", "Học viên nộp bài", "Học viên", "Nộp nội dung trực tiếp và tệp đính kèm, lưu nhiều lần nộp.", "Mở bài tập; soạn nội dung; đính kèm tối đa năm tệp; nộp bài; còn hạn thì cho nộp lại và lưu các lần nộp.", "Quá hạn: từ chối hoặc đánh dấu nộp muộn theo quy tắc bài tập.", "Bài tập phải công bố và còn hạn; bài nộp sẵn sàng cho giảng viên chấm.", "P1"],
      ["2.6.3", "Chấm bài và sửa điểm", "Giảng viên", "Chấm lần đầu và sửa điểm công bố minh bạch, có lịch sử.", "Mở hàng đợi; chọn bài nộp; chấm theo rubric và nhận xét; ghi lần chấm đầu, công bố điểm; sửa điểm khi cần và ghi lịch sử.", "Cho phép xem gradebook theo lớp.", "Phân biệt lần chấm đầu với chỉnh sửa điểm; bài nộp có điểm, nhận xét và lịch sử.", "P1"],
      ["2.6.4", "Nhận gợi ý chấm bài bằng AI", "Giảng viên", "Tạo gợi ý theo rubric, giữ quyết định cuối cùng ở giảng viên.", "Yêu cầu gợi ý; đọc bài và rubric; hiển thị gợi ý cùng nguồn; giảng viên xem, đánh giá, chủ động áp dụng.", "DOCX đọc cục bộ; PDF/ảnh dùng OCR.", "AI không tự ghi điểm; chỉ lưu điểm sau khi giảng viên xác nhận áp dụng.", "P1"],
    ],
  },
  {
    number: "2.7",
    title: "Chat, diễn đàn và thông báo",
    sheet: "09 2.7 Trao đổi",
    items: [
      ["2.7.1", "Nhắn tin trực tiếp và trong lớp", "Người dùng có quyền chat", "Chat riêng và chat lớp thời gian thực, có trạng thái đọc và kiểm soát an toàn.", "Mở danh bạ; mở hội thoại riêng/chung; gửi chữ/ảnh/tệp; cập nhật đã đọc; trả lời, nhắc tên, tìm kiếm, tắt thông báo, chặn.", "Mỗi cặp chỉ có một hội thoại riêng; lớp đóng thì chat lớp chỉ đọc; có thể báo cáo/chặn người khác.", "Chống gửi lặp bằng idempotency; thẻ ngữ cảnh phải kiểm tra lại quyền người nhận trước khi trả dữ liệu.", "P1"],
      ["2.7.2", "Trao đổi trên diễn đàn", "Giảng viên và học viên", "Thảo luận theo chủ đề trong lớp, có điều hành nội dung.", "Tạo chủ đề; đăng/trả lời; quản trị ghim, khóa, ẩn; thành viên sửa/xóa bài của mình theo quyền.", "Nội dung vi phạm có thể báo cáo để chuyển sang kiểm duyệt.", "Diễn đàn phải phản ánh nội dung và trạng thái điều hành đúng quyền.", "P2"],
      ["2.7.3", "Nhận và theo dõi thông báo", "Mọi người dùng đã đăng nhập", "Thông báo theo sự kiện có liên kết sâu và đồng bộ trạng thái đã đọc.", "Tạo thông báo; hiển thị danh sách và liên kết sâu; bấm để đến đối tượng liên quan và đánh dấu đã đọc; đồng bộ đa thiết bị.", "Không có ngoại lệ riêng trong đặc tả.", "Có sự kiện liên quan mới tạo thông báo; trạng thái đã đọc phải đồng bộ.", "P2"],
    ],
  },
  {
    number: "2.8",
    title: "Hỗ trợ",
    sheet: "10 2.8 Hỗ trợ",
    items: [
      ["2.8.1", "Gửi và xử lý phiếu hỗ trợ", "Người dùng, quản lý trung tâm hoặc quản trị", "Tạo và xử lý phiếu hỗ trợ theo SLA, có lịch sử trao đổi.", "Tạo phiếu kèm mô tả/tệp; tiếp nhận và gán trạng thái/SLA; trao đổi qua bình luận, cập nhật tiến độ; ghi kết quả và xác nhận đóng.", "Người gửi có thể bổ sung thông tin hoặc tệp trong khi xử lý.", "Trạng thái đúng: mở, đang xử lý, đã giải quyết hoặc đã đóng; lịch sử trao đổi phải có.", "P2"],
    ],
  },
  {
    number: "2.9",
    title: "Công cụ AI có kiểm soát",
    sheet: "11 2.9 Công cụ AI",
    items: [
      ["2.9.1", "Cấu hình provider và tác vụ AI", "Quản trị hệ thống", "Quản lý API key, provider và model riêng cho từng tác vụ AI.", "Thêm/cập nhật API key; gán provider/model cho sinh đề, quét ảnh, OCR, hỏi đáp, bộ ôn tập, chấm bài; tải/chọn model; kiểm tra kết nối và lưu.", "Hỗ trợ Gemini, OpenAI, NVIDIA NIM và Custom tương thích OpenAI; danh sách model được chuẩn hóa/giới hạn kích thước.", "Cấu hình phải sẵn sàng trước khi các tác vụ nghiệp vụ AI được dùng.", "P1"],
      ["2.9.2", "Hỏi đáp tài liệu và tạo bộ ôn tập", "Giảng viên", "Hỏi đáp trên tài liệu có nguồn trích và tạo tóm tắt/flashcard theo phiên bản tài liệu.", "Đặt câu hỏi trên tài liệu; trả lời kèm nguồn, ghim phiên bản; lưu lịch sử riêng; sinh tóm tắt/flashcard; sửa, phát hành hoặc thu hồi bộ ôn tập.", "Không có ngoại lệ riêng trong đặc tả.", "Snapshot đã phát hành không bị thay đổi khi chỉnh sửa bộ ôn tập; tài liệu và provider phải sẵn sàng.", "P2"],
    ],
  },
  {
    number: "2.10",
    title: "Đa ngôn ngữ Việt - Anh",
    sheet: "12 2.10 Đa ngôn ngữ",
    items: [
      ["2.10.1", "Chọn và áp dụng ngôn ngữ hiển thị", "Mọi người dùng", "Chọn tiếng Việt/Anh và hiển thị nhất quán theo lựa chọn.", "Chọn ngôn ngữ; lưu cookie, local storage, hồ sơ; đổi giao diện, lang page, định dạng ngày giờ/số; gửi Accept-Language; API trả thông báo tương ứng.", "Nội dung do người dùng tạo, tên khóa học/lớp/tệp không tự động dịch.", "Trải nghiệm hiển thị nhất quán giữa các thiết bị.", "P2"],
    ],
  },
];

// Returns a normalized initial tracker row for a single checklist item.
function initialRow(taskId, functionId, category, criteria, priority) {
  return [false, taskId, functionId, category, criteria, priority, "Chưa bắt đầu", "Chưa phân công", "", null, "", "", ""];
}

// Expands one functional specification into build, flow, rule, and QA tracking tasks.
function createFunctionTasks(section, item, index) {
  const [functionId, name, actor, goal, flow, exception, rule, priority] = item;
  const taskPrefix = `${section.number.replace(".", "")}-${String(index).padStart(2, "0")}`;
  return [
    initialRow(`TASK-${taskPrefix}-01`, functionId, `[Chức năng] ${name}`, `Mục tiêu: ${goal} Tác nhân: ${actor}.`, priority),
    initialRow(`TASK-${taskPrefix}-02`, functionId, `[Luồng chính] ${name}`, `Hoàn tất khi thực hiện đúng: ${flow}`, priority),
    initialRow(`TASK-${taskPrefix}-03`, functionId, `[Ngoại lệ / ràng buộc] ${name}`, `Ngoại lệ: ${exception} Quy tắc cần giữ: ${rule}`, priority),
    initialRow(`TASK-${taskPrefix}-04`, functionId, `[Kiểm thử] ${name}`, `Có test luồng chính, phân quyền của ${actor}, dữ liệu thiếu/sai/biên, ngoại lệ và quy tắc nghiệp vụ. Không còn lỗi nghiêm trọng trước nghiệm thu.`, priority),
  ];
}

// Defines shared layout and typography for every operational tracking sheet.
function formatTaskSheet(sheet, title, sourceText, rows, tableName) {
  sheet.showGridLines = false;
  sheet.mergeCells("A1:M1");
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1:M1").format = {
    font: { name: fontName, size: 15, bold: true, color: "#1F2937" },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange("A1:M1").format.rowHeight = 28;
  sheet.mergeCells("A2:M2");
  sheet.getRange("A2").values = [[sourceText]];
  sheet.getRange("A2:M2").format = {
    font: { name: fontName, size: 9, italic: true, color: "#4B5563" },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange("A2:M2").format.rowHeight = 20;

  sheet.getRange("A4:H4").values = [["Tổng task", "", "Hoàn thành", "", "Đang thực hiện", "", "% hoàn thành", ""]];
  sheet.getRange("A4:H4").format = {
    fill: "#F3F4F6",
    font: { name: fontName, size: 9, bold: true, color: "#374151" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("A5:H5").formulas = [[
    `=COUNTA(B7:B${rows.length + 6})`,
    "",
    `=COUNTIF(G7:G${rows.length + 6},\"Hoàn thành\")`,
    "",
    `=COUNTIF(G7:G${rows.length + 6},\"Đang thực hiện\")`,
    "",
    `=IF(A5=0,0,C5/A5)`,
    "",
  ]];
  sheet.getRange("A5:H5").format = {
    fill: "#FFFFFF",
    font: { name: fontName, size: 10, bold: true, color: "#111827" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("G5").format.numberFormat = "0%";
  sheet.getRange("A4:H5").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  sheet.mergeCells("J4:M5");
  sheet.getRange("J4").values = [["Quy ước: Status là trạng thái chính. Khi hoàn tất, tích Done?, cập nhật ngày, phiên bản/commit, nội dung thay đổi và lưu ý còn lại."]];
  sheet.getRange("J4:M5").format = {
    fill: "#FFF7E6",
    font: { name: fontName, size: 9, italic: true, color: "#7C4A03" },
    horizontalAlignment: "left",
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("J4:M5").format.borders = { preset: "outside", style: "thin", color: "#E5C07B" };

  sheet.getRange("A6:M6").values = [headers];
  sheet.getRange(`A7:M${rows.length + 6}`).values = rows;
  sheet.getRange("A6:M6").format = {
    fill: "#333333",
    font: { name: fontName, size: 9, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("A6:M6").format.rowHeight = 32;
  sheet.getRange(`A7:M${rows.length + 6}`).format = {
    font: { name: fontName, size: 9, color: "#1F2937" },
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange(`A7:A${rows.length + 6}`).format = { fill: "#F2F2F4", horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`F7:H${rows.length + 6}`).format = { horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`I7:K${rows.length + 6}`).format = { horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`F7:F${rows.length + 6}`).format.fill = "#FFF4D6";
  sheet.getRange(`G7:G${rows.length + 6}`).format.fill = "#E5F2FF";
  sheet.getRange(`H7:H${rows.length + 6}`).format.fill = "#F2F2F4";
  sheet.getRange(`I7:I${rows.length + 6}`).format.fill = "#F2EAFF";
  sheet.getRange(`J7:J${rows.length + 6}`).format.fill = "#F2EAFF";
  sheet.getRange(`L7:M${rows.length + 6}`).format.fill = "#FFFDF2";

  sheet.getRange(`F7:F${rows.length + 6}`).dataValidation = { rule: { type: "list", values: ["P1", "P2", "P3"] } };
  sheet.getRange(`G7:G${rows.length + 6}`).dataValidation = { rule: { type: "list", values: ["Chưa bắt đầu", "Đang thực hiện", "Chờ kiểm tra", "Hoàn thành", "Blocked", "Không áp dụng"] } };
  sheet.getRange(`H7:H${rows.length + 6}`).dataValidation = { rule: { type: "list", values: ["Chưa phân công", "Wind Of Fall", "Quản trị hệ thống", "Quản lý trung tâm", "Giảng viên", "Học viên"] } };
  sheet.getRange(`I7:I${rows.length + 6}`).dataValidation = { rule: { type: "list", values: ["Backlog", "Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4", "Nghiệm thu"] } };
  sheet.getRange(`J7:J${rows.length + 6}`).format.numberFormat = "dd/mm/yyyy";
  sheet.getRange(`J7:J${rows.length + 6}`).dataValidation = { rule: { type: "date", operator: "between", formula1: "2020-01-01", formula2: "2100-12-31" } };

  const statusRange = sheet.getRange(`G7:G${rows.length + 6}`);
  statusRange.conditionalFormats.add("containsText", { text: "Hoàn thành", format: { fill: "#C6EFCE", font: { color: "#006100", bold: true } } });
  statusRange.conditionalFormats.add("containsText", { text: "Đang thực hiện", format: { fill: "#DDEBF7", font: { color: "#1F4E78", bold: true } } });
  statusRange.conditionalFormats.add("containsText", { text: "Chờ kiểm tra", format: { fill: "#FFF2CC", font: { color: "#7F6000", bold: true } } });
  statusRange.conditionalFormats.add("containsText", { text: "Blocked", format: { fill: "#F4CCCC", font: { color: "#9C0006", bold: true } } });
  sheet.getRange(`F7:F${rows.length + 6}`).conditionalFormats.add("containsText", { text: "P1", format: { fill: "#FCE4D6", font: { color: "#C00000", bold: true } } });

  const table = sheet.tables.add(`A6:M${rows.length + 6}`, true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(6);
  sheet.freezePanes.freezeColumns(3);

  const widths = [9, 17, 13, 33, 58, 10, 18, 19, 13, 14, 18, 38, 38];
  widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = width; });
  sheet.getRange(`A7:M${rows.length + 6}`).format.rowHeight = 48;
}

// Creates the overview sheet with linked progress counters for each tracking area.
function populateOverview(sheet, trackerSheets) {
  sheet.showGridLines = false;
  sheet.mergeCells("A1:H1");
  sheet.getRange("A1").values = [["CHECKTASK - HỆ THỐNG TRUNG TÂM"]];
  sheet.getRange("A1:H1").format = { font: { name: fontName, size: 16, bold: true, color: "#1F2937" }, verticalAlignment: "center" };
  sheet.getRange("A1:H1").format.rowHeight = 30;
  sheet.mergeCells("A2:H2");
  sheet.getRange("A2").values = [["Theo dõi tiến độ, thay đổi, phiên bản và lưu ý theo từng mục lớn trong đặc tả chức năng."]];
  sheet.getRange("A2:H2").format = { font: { name: fontName, size: 10, italic: true, color: "#4B5563" }, verticalAlignment: "center" };

  sheet.getRange("A4:H4").values = [["Tổng task", "Hoàn thành", "Đang thực hiện", "Chờ kiểm tra", "Blocked", "% hoàn thành", "Nguồn đặc tả", "Cập nhật gần nhất"]];
  sheet.getRange("A4:H4").format = { fill: "#333333", font: { name: fontName, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange("A5:H5").formulas = [[
    `=SUM(D9:D${trackerSheets.length + 8})`,
    `=SUM(E9:E${trackerSheets.length + 8})`,
    `=SUM(F9:F${trackerSheets.length + 8})`,
    `=SUM(G9:G${trackerSheets.length + 8})`,
    `=SUM(H9:H${trackerSheets.length + 8})`,
    "=IF(A5=0,0,B5/A5)",
    "=\"Đặc tả chức năng hệ thống trung tâm\"",
    "=IF(COUNT(J9:J" + (trackerSheets.length + 8) + ")=0,\"\",MAX(J9:J" + (trackerSheets.length + 8) + "))",
  ]];
  sheet.getRange("A5:H5").format = { fill: "#FFFFFF", font: { name: fontName, size: 10, bold: true, color: "#111827" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange("F5").format.numberFormat = "0%";
  sheet.getRange("H5").format.numberFormat = "dd/mm/yyyy";
  sheet.getRange("A4:H5").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };

  sheet.getRange("A7:J7").values = [["STT", "Mục lớn", "Sheet theo dõi", "Tổng task", "Hoàn thành", "Đang thực hiện", "Chờ kiểm tra", "Blocked", "% hoàn thành", "Cập nhật gần nhất"]];
  sheet.getRange("A7:J7").format = { fill: "#4B5563", font: { name: fontName, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  const data = trackerSheets.map((info, index) => {
    const end = info.rowCount + 6;
    return {
      values: [index + 1, info.title, info.sheet],
      formulas: [`=COUNTA('${info.sheet}'!B7:B${end})`, `=COUNTIF('${info.sheet}'!G7:G${end},\"Hoàn thành\")`, `=COUNTIF('${info.sheet}'!G7:G${end},\"Đang thực hiện\")`, `=COUNTIF('${info.sheet}'!G7:G${end},\"Chờ kiểm tra\")`, `=COUNTIF('${info.sheet}'!G7:G${end},\"Blocked\")`, `=IF(D${index + 9}=0,0,E${index + 9}/D${index + 9})`, `=IF(COUNT('${info.sheet}'!J7:J${end})=0,\"\",MAX('${info.sheet}'!J7:J${end}))`],
    };
  });
  sheet.getRange(`A9:C${trackerSheets.length + 8}`).values = data.map((row) => row.values);
  sheet.getRange(`D9:J${trackerSheets.length + 8}`).formulas = data.map((row) => row.formulas);
  sheet.getRange(`A9:J${trackerSheets.length + 8}`).format = { font: { name: fontName, size: 10, color: "#1F2937" }, verticalAlignment: "center", wrapText: true };
  sheet.getRange(`A9:A${trackerSheets.length + 8}`).format.horizontalAlignment = "center";
  sheet.getRange(`D9:J${trackerSheets.length + 8}`).format.horizontalAlignment = "center";
  sheet.getRange(`I9:I${trackerSheets.length + 8}`).format.numberFormat = "0%";
  sheet.getRange(`J9:J${trackerSheets.length + 8}`).format.numberFormat = "dd/mm/yyyy";
  sheet.getRange(`A7:J${trackerSheets.length + 8}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  sheet.getRange(`A9:J${trackerSheets.length + 8}`).format.rowHeight = 27;
  sheet.getRange(`H9:H${trackerSheets.length + 8}`).conditionalFormats.add("cellIs", { operator: "greaterThan", formula: 0, format: { fill: "#F4CCCC", font: { color: "#9C0006", bold: true } } });
  sheet.getRange(`I9:I${trackerSheets.length + 8}`).conditionalFormats.add("colorScale", { colors: ["#F8696B", "#FFEB84", "#63BE7B"], thresholds: ["min", { type: "percentile", value: 50 }, "max"] });

  const noteStart = trackerSheets.length + 11;
  sheet.mergeCells(`A${noteStart}:J${noteStart}`);
  sheet.getRange(`A${noteStart}`).values = [["Hướng dẫn cập nhật: Mỗi khi sửa project, cập nhật Status, Ngày cập nhật, Phiên bản / Commit, Đã sửa / thay đổi và Lưu ý / Blocker trên sheet mục tương ứng. Không tạo sheet theo vai trò."]];
  sheet.getRange(`A${noteStart}:J${noteStart}`).format = { fill: "#FFF7E6", font: { name: fontName, size: 10, italic: true, color: "#7C4A03" }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange(`A${noteStart}:J${noteStart}`).format.rowHeight = 36;
  const widths = [7, 33, 25, 12, 13, 16, 15, 12, 16, 18];
  widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = width; });
  sheet.freezePanes.freezeRows(7);
  return sheet;
}

// Builds every tracker sheet, validates calculations, and exports the finished workbook.
async function buildWorkbook() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  const workbook = Workbook.create();
  const overview = workbook.worksheets.add("01 Tổng quan");
  const trackerSheets = [];

  const roleRows = roles.map((role, index) => initialRow(`TASK-USER-${String(index + 1).padStart(2, "0")}`, role.id, `[Vai trò] ${role.name}`, `Phạm vi chức năng phải được phân quyền và kiểm thử: ${role.detail}`, "P1"));
  const roleSheet = workbook.worksheets.add("02 Nhóm người dùng");
  formatTaskSheet(roleSheet, "1. CÁC NHÓM NGƯỜI DÙNG", "Nguồn: Mục 1 của tài liệu đặc tả. Sheet này chỉ theo dõi phạm vi và phân quyền; các chức năng chi tiết nằm ở các sheet 2.1 đến 2.10.", roleRows, "UserGroupsTasks");
  trackerSheets.push({ title: "1. Các nhóm người dùng", sheet: roleSheet.name, rowCount: roleRows.length });

  sections.forEach((section, sectionIndex) => {
    const sheet = workbook.worksheets.add(section.sheet);
    const taskRows = section.items.flatMap((item, itemIndex) => createFunctionTasks(section, item, itemIndex + 1));
    formatTaskSheet(sheet, `${section.number}. ${section.title.toUpperCase()}`, `Nguồn: Mục ${section.number} trong tài liệu đặc tả. Theo dõi theo chức năng, luồng chính, ngoại lệ/ràng buộc và kiểm thử.`, taskRows, `Section${sectionIndex + 1}Tasks`);
    trackerSheets.push({ title: `${section.number}. ${section.title}`, sheet: sheet.name, rowCount: taskRows.length });
  });

  populateOverview(overview, trackerSheets);
  workbook.recalculate();

  const summaryCheck = await workbook.inspect({ kind: "table", range: "01 Tổng quan!A1:J22", include: "values,formulas", tableMaxRows: 22, tableMaxCols: 10 });
  await fs.writeFile(`${outputDir}/qa_summary_inspection.ndjson`, summaryCheck.ndjson, "utf8");
  const errorCheck = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
  await fs.writeFile(`${outputDir}/qa_formula_errors.ndjson`, errorCheck.ndjson, "utf8");

  const summaryPreview = await workbook.render({ sheetName: "01 Tổng quan", range: "A1:J23", scale: 2, format: "png" });
  await fs.writeFile(`${previewDir}/overview.png`, new Uint8Array(await summaryPreview.arrayBuffer()));
  const detailPreview = await workbook.render({ sheetName: "07 2.5 Đề thi", range: "A1:M27", scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}/exam-module.png`, new Uint8Array(await detailPreview.arrayBuffer()));

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(JSON.stringify({ outputPath, summaryCheck: summaryCheck.ndjson, errorCheck: errorCheck.ndjson }, null, 2));
}

await buildWorkbook();
