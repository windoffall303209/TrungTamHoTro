import type { RoleCode } from "@/lib/app-types";

export type GuideRoleKey = "LEARNER" | "INSTRUCTOR" | "CENTER_MANAGER" | "SYSTEM_ADMIN";

export interface GuideStep {
  title: string;
  detail: string;
}

export interface GuideSection {
  id: string;
  title: string;
  summary: string;
  actionHref: string;
  actionLabel: string;
  steps: GuideStep[];
  tip?: string;
}

export interface GuideFaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface RoleGuideContent {
  role: GuideRoleKey;
  label: string;
  badge: string;
  intro: string;
  sections: GuideSection[];
  faqs: GuideFaqItem[];
}

/** Ánh xạ mã vai trò phiên đăng nhập hiện tại sang tab hướng dẫn mặc định phù hợp. */
export function resolveDefaultGuideRole(roleCode?: RoleCode | string): GuideRoleKey {
  if (roleCode === "INSTRUCTOR") return "INSTRUCTOR";
  if (roleCode === "CENTER_MANAGER") return "CENTER_MANAGER";
  if (roleCode === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";
  return "LEARNER";
}

export const ROLE_GUIDE_CATALOG: readonly [RoleGuideContent, ...RoleGuideContent[]] = [
  {
    role: "LEARNER",
    label: "Học sinh",
    badge: "Không gian học tập",
    intro: "Theo dõi lớp học, lịch Google Meet, tài liệu, làm bài tập và quản lý bảo mật tài khoản cá nhân.",
    sections: [
      {
        id: "learner-classes",
        title: "Theo dõi lớp học và thông báo",
        summary: "Truy cập danh sách lớp đang theo học, xem bảng tin, thành viên và điểm số cá nhân.",
        actionHref: "/courses",
        actionLabel: "Mở trang Lớp học",
        steps: [
          {
            title: "Chọn lớp học đang tham gia",
            detail: "Từ thanh điều hướng ngang, vào mục Lớp học và bấm vào lớp cần xem để mở không gian học tập chi tiết.",
          },
          {
            title: "Đọc thông báo trên Bảng tin",
            detail: "Tab Bảng tin hiển thị các thông báo mới từ giảng viên, thảo luận bài học và bình luận theo lớp.",
          },
          {
            title: "Theo dõi tiến độ và điểm số",
            detail: "Kiểm tra kết quả bài đã chấm tại tab Bài tập hoặc tab Bảng điểm (khi lớp cho phép xem bảng điểm).",
          },
        ],
        tip: "Kiểm tra biểu tượng chuông ở góc trên bên phải để không bỏ lỡ thông báo chấm bài hoặc lịch học mới.",
      },
      {
        id: "learner-materials-live",
        title: "Học liệu, bài giảng và lịch Google Meet",
        summary: "Xem bài giảng, tải tài liệu trong lớp và mở đúng phòng học trực tuyến theo lịch.",
        actionHref: "/live-classes",
        actionLabel: "Mở Lịch học",
        steps: [
          {
            title: "Xem bài giảng và tài liệu lớp",
            detail: "Trong chi tiết lớp, mở tab Bài giảng hoặc Tài liệu để xem trực tiếp video/PDF/tài liệu đã công bố hoặc tải về máy.",
          },
          {
            title: "Tra cứu ở Kho học liệu",
            detail: "Ngoài trang chi tiết lớp, có thể tìm lại nhanh tài liệu theo cấu trúc Khối → Môn → Lớp → Thư mục → Tệp.",
          },
          {
            title: "Vào buổi học trực tuyến",
            detail: "Mở tab Lịch học trong lớp hoặc trang Lịch học chung, kiểm tra khung giờ và bấm link Google Meet được giảng viên gắn cho buổi học.",
          },
        ],
        tip: "Một số học liệu đang ở trạng thái Ẩn sẽ chưa hiển thị cho đến khi giảng viên công bố.",
      },
      {
        id: "learner-assignments",
        title: "Làm bài trắc nghiệm và nộp bài tự luận",
        summary: "Làm bài thi trực tuyến, đính kèm tệp tự luận và cập nhật bài nộp mới nhất trước hạn.",
        actionHref: "/courses",
        actionLabel: "Vào mục Bài tập lớp",
        steps: [
          {
            title: "Làm bài trắc nghiệm trong hộp thoại thi",
            detail: "Mở đề trắc nghiệm ở tab Bài tập, theo dõi bộ đếm thời gian, bảng đánh dấu câu đã làm và bấm Nộp bài khi hoàn tất.",
          },
          {
            title: "Nộp bài tự luận kèm tệp",
            detail: "Nhập nội dung trả lời hoặc chọn tệp đính kèm hợp lệ rồi bấm Gửi bài làm trước thời hạn nộp.",
          },
          {
            title: "Nộp lại bài khi còn hạn",
            detail: "Nếu giảng viên cho phép và còn hạn, lần nộp mới sẽ cập nhật trực tiếp bài nộp hiện hành cùng bộ tệp đang giữ lại hoặc thay mới.",
          },
        ],
        tip: "Kiểm tra kỹ danh sách tệp giữ lại và tệp tải lên mới trước khi bấm xác nhận nộp lại bài.",
      },
      {
        id: "learner-communication-account",
        title: "Tin nhắn, bảo mật 2 bước và gửi hỗ trợ",
        summary: "Trao đổi trực tiếp với giảng viên, bật xác thực OTP và gửi phiếu khi gặp sự cố.",
        actionHref: "/account?tab=security",
        actionLabel: "Mở Bảo mật tài khoản",
        steps: [
          {
            title: "Nhắn tin nhanh",
            detail: "Mở trang Tin nhắn trên thanh điều hướng hoặc dùng cửa sổ Chat Mini ở góc dưới bên phải màn hình.",
          },
          {
            title: "Thiết lập bảo mật và xác thực 2 bước",
            detail: "Vào Menu tài khoản → Bảo mật để đổi mật khẩu, xác minh email và bật xác thực đăng nhập bằng mã OTP qua email.",
          },
          {
            title: "Gửi phiếu hỗ trợ kỹ thuật",
            detail: "Khi gặp lỗi tài khoản hoặc bài học, mở Menu tài khoản → Hỗ trợ để tạo phiếu mô tả sự cố và đính kèm ảnh chụp màn hình.",
          },
        ],
      },
    ],
    faqs: [
      {
        id: "learner-faq-1",
        question: "Tại sao bấm vào buổi học nhưng chưa vào được phòng họp?",
        answer: "Buổi học cần có link Google Meet hợp lệ do giảng viên gắn vào trước giờ học. Nếu buổi học chưa đến giờ hoặc chưa gắn link, hãy nhắn tin hỏi giảng viên của lớp.",
      },
      {
        id: "learner-faq-2",
        question: "Khi nộp lại bài tự luận thì bài cũ xử lý thế nào?",
        answer: "Hệ thống chỉ giữ lại bài nộp mới nhất cùng danh sách tệp hiện hành để tránh chấm nhầm giữa các lần nộp. Bạn cần chọn giữ hoặc thay lại tệp cần thiết ở lần nộp mới.",
      },
      {
        id: "learner-faq-3",
        question: "Quên mật khẩu hoặc đổi thiết bị không có mã OTP thì làm sao?",
        answer: "Dùng chức năng Quên mật khẩu ở màn hình đăng nhập. Nếu mất thiết bị xác thực 2 bước, hãy đăng nhập bằng một mã khôi phục đã lưu khi bật tính năng này.",
      },
    ],
  },
  {
    role: "INSTRUCTOR",
    label: "Giáo viên",
    badge: "Giảng dạy & Khảo thí",
    intro: "Vận hành lớp học được phân công, tải học liệu đúng thư mục, soạn ngân hàng câu hỏi LaTeX, tạo đề và chấm bài.",
    sections: [
      {
        id: "instructor-class-schedule",
        title: "Quản lý lớp học và lịch giảng dạy Google Meet",
        summary: "Điều phối bảng tin, xem danh sách học viên, vai trò trong lớp và gắn link phòng họp cho từng buổi học.",
        actionHref: "/live-classes",
        actionLabel: "Mở Lịch Học",
        steps: [
          {
            title: "Chọn lớp được phân công",
            detail: "Vào mục Lớp học trên thanh header ngang và mở lớp mà bạn là giảng viên chính hoặc đồng giảng viên.",
          },
          {
            title: "Thêm buổi học mới",
            detail: "Trong tab Lịch học, chọn ngày học, giờ bắt đầu, giờ kết thúc và dán đường dẫn Google Meet thực tế (https://meet.google.com/...).",
          },
          {
            title: "Cập nhật hoặc hủy buổi học",
            detail: "Chỉnh sửa thời gian/link trực tiếp trên danh sách buổi học hoặc nhập lý do khi hủy để hệ thống thông báo tới học viên trong lớp.",
          },
        ],
        tip: "Chỉ giảng viên chính hoặc đồng giảng viên được phân công trong lớp mới có quyền tạo và điều chỉnh buổi học của lớp đó.",
      },
      {
        id: "instructor-materials",
        title: "Tải lên và tổ chức Học liệu theo thư mục lớp",
        summary: "Đi đúng luồng Khối → Môn → Lớp → Thư mục → Tệp khi làm việc ở trang Học Liệu.",
        actionHref: "/materials",
        actionLabel: "Mở trang Học Liệu",
        steps: [
          {
            title: "Mở đến đúng thư mục của lớp",
            detail: "Ở trang Học Liệu, chọn lần lượt Khối → Môn → Lớp được phân công rồi mở một thư mục Tài liệu hoặc Bài giảng cụ thể. Nếu chưa có thư mục, bấm Tạo thư mục trước.",
          },
          {
            title: "Tải tài liệu hoặc bài giảng",
            detail: "Nút Tải tài liệu / bài giảng chỉ bật khi bạn đang mở một thư mục cụ thể và có quyền giảng dạy trong lớp. Tệp tải lên sẽ tự động gắn vào đúng lớp và thư mục đó.",
          },
          {
            title: "Chỉnh sửa, thay tệp hoặc ẩn/hiện",
            detail: "Dùng menu thao tác trên từng học liệu để đổi tên, chuyển trạng thái Đã công bố / Đã ẩn hoặc thay tệp mới (tệp cũ sẽ được xóa và thay bằng tệp mới).",
          },
        ],
        tip: "Mọi học liệu mới bắt buộc phải thuộc về một lớp học và thư mục hợp lệ; không tải học liệu rời ngoài lớp.",
      },
      {
        id: "instructor-questions-latex",
        title: "Ngân hàng câu hỏi LaTeX và quét ảnh đề OCR",
        summary: "Soạn câu hỏi toán/khoa học với công thức LaTeX, kiểm tra bản render trước khi lưu và quét ảnh đề thi.",
        actionHref: "/questions",
        actionLabel: "Mở Ngân hàng câu hỏi",
        steps: [
          {
            title: "Xem công thức tự động ở danh sách",
            detail: "Cả trang Ngân hàng câu hỏi chung lẫn tab Ngân hàng câu hỏi riêng trong lớp đều tự động render công thức KaTeX cho đề bài, các phương án A/B/C/D và lời giải.",
          },
          {
            title: "Chỉnh sửa bằng text LaTeX gốc",
            detail: "Khi bấm Chỉnh sửa hoặc Soạn câu hỏi mới, các ô nhập hiển thị nguyên dạng text LaTeX (ví dụ $\\frac{16}{24}$ hoặc \\(\\frac{2}{3}\\)) để sửa chính xác từng ký tự.",
          },
          {
            title: "Kiểm tra bản render bằng nút Xem giao diện",
            detail: "Bấm nút Xem giao diện ngay trên hộp thoại soạn/chỉnh sửa để xem trước toàn bộ thẻ câu hỏi sau khi render KaTeX, sau đó bấm Quay lại chỉnh sửa hoặc Lưu.",
          },
        ],
        tip: "Bạn cũng có thể vào Quét ảnh đề (/questions/scan) hoặc nhập nhanh JSONL khi cần đưa hàng loạt câu hỏi vào ngân hàng.",
      },
      {
        id: "instructor-exams-grading",
        title: "Tạo đề kiểm tra, chấm tự luận và xuất bảng điểm",
        summary: "Đóng gói đề thi từ ngân hàng, sinh đề AI, chấm bài tự luận có gợi ý AI tham khảo và xuất CSV.",
        actionHref: "/courses",
        actionLabel: "Mở Lớp học để tạo đề",
        steps: [
          {
            title: "Tạo đề thi từ nhiều phương thức",
            detail: "Trong tab Bài tập hoặc Ngân hàng câu hỏi của lớp, chọn Tạo đề thủ công từ ngân hàng, Lọc theo độ khó, Sinh đề bằng AI hoặc Tạo bài tập tự luận.",
          },
          {
            title: "Làm thử đề và chấm bài tự luận",
            detail: "Dùng nút Làm thử để kiểm tra hiển thị đề mà không lưu điểm thử vào CSDL. Với bài tự luận, mở Chi tiết bài nộp để chấm điểm theo rubric hoặc tham khảo gợi ý AI.",
          },
          {
            title: "Theo dõi và xuất Bảng điểm",
            detail: "Mở tab Bảng điểm của lớp để xem tổng hợp điểm thi, bài tập và tải xuống bảng điểm CSV.",
          },
        ],
      },
    ],
    faqs: [
      {
        id: "instructor-faq-1",
        question: "Vì sao nút Tải tài liệu / bài giảng bị mờ không bấm được?",
        answer: "Nút tải lên chỉ mở khóa khi bạn đã đi tới một thư mục cụ thể trong đúng lớp được phân công giảng dạy (giảng viên chính hoặc đồng giảng viên). Ở cấp Khối, Môn hoặc Lớp chưa chọn thư mục thì nút sẽ tự khóa.",
      },
      {
        id: "instructor-faq-2",
        question: "Vì sao khi ấn Chỉnh sửa câu hỏi lại hiện ký tự $...$ thay vì công thức đẹp?",
        answer: "Khi chỉnh sửa, hệ thống cố ý hiển thị mã text LaTeX gốc để bạn dễ gõ và sửa công thức. Hãy bấm nút Xem giao diện trên hộp thoại chỉnh sửa để xem bản render KaTeX trước khi bấm lưu.",
      },
      {
        id: "instructor-faq-3",
        question: "Thay tệp mới cho học liệu có giữ lại tệp cũ không?",
        answer: "Không. Khi bạn thay tệp mới, hệ thống thay thế bằng tệp mới nhất và xóa tệp cũ để kho lưu trữ luôn gọn gàng.",
      },
    ],
  },
  {
    role: "CENTER_MANAGER",
    label: "Quản lý trung tâm",
    badge: "Điều phối đào tạo",
    intro: "Quản lý vòng đời lớp học, phân công giảng viên, kiểm soát danh sách người dùng và điều phối hỗ trợ học viên.",
    sections: [
      {
        id: "manager-class-ops",
        title: "Điều hành và quản lý vòng đời lớp học",
        summary: "Mở lớp mới, phân công giảng viên phụ trách, ghi danh học viên và theo dõi trạng thái hoạt động của lớp.",
        actionHref: "/class-operations",
        actionLabel: "Mở Điều hành lớp",
        steps: [
          {
            title: "Thiết lập thông tin lớp và phân công",
            detail: "Tại Điều hành lớp, chọn lớp cần quản lý để thêm/điều chỉnh giảng viên chính, đồng giảng viên và danh sách học viên ghi danh.",
          },
          {
            title: "Theo dõi trạng thái vòng đời lớp",
            detail: "Mở mục Vòng đời lớp để chuyển trạng thái lớp (đang hoạt động, kết thúc hoặc lưu trữ) theo đúng kế hoạch khóa học.",
          },
        ],
        tip: "Chỉ các giảng viên được phân công trong lớp mới có quyền tạo thư mục và đăng học liệu cho lớp đó.",
      },
      {
        id: "manager-monitoring",
        title: "Giám sát lớp học, khảo thí và người dùng",
        summary: "Theo dõi hoạt động trong lớp, kiểm duyệt đề thi khi cần và quản lý thông tin tài khoản trung tâm.",
        actionHref: "/admin/users",
        actionLabel: "Mở Quản lý người dùng",
        steps: [
          {
            title: "Kiểm tra người dùng và trạng thái xác minh",
            detail: "Mở Người dùng để tìm kiếm học viên/giảng viên, xem trạng thái tài khoản và hỗ trợ xử lý các vấn đề truy cập cơ bản.",
          },
          {
            title: "Rà soát học liệu và đề thi",
            detail: "Vào Lớp học hoặc Khảo thí để theo dõi tiến độ giảng dạy, đề đã phát hành và tình hình làm bài của học viên.",
          },
        ],
      },
      {
        id: "manager-support",
        title: "Tiếp nhận và xử lý phiếu hỗ trợ",
        summary: "Phản hồi yêu cầu từ học viên/giảng viên, kiểm tra ảnh bằng chứng và cập nhật trạng thái xử lý.",
        actionHref: "/support",
        actionLabel: "Mở trang Hỗ trợ",
        steps: [
          {
            title: "Xem danh sách phiếu mới",
            detail: "Vào mục Hỗ trợ trên thanh điều hướng để lọc các phiếu đang mở theo mức độ ưu tiên.",
          },
          {
            title: "Trao đổi và chốt kết quả",
            detail: "Mở chi tiết phiếu, xem ảnh đính kèm, nhắn phản hồi và ghi nhận phương án giải quyết khi hoàn tất.",
          },
        ],
      },
    ],
    faqs: [
      {
        id: "manager-faq-1",
        question: "Làm sao cấp quyền cho đồng giảng viên đăng tải học liệu vào lớp?",
        answer: "Vào Điều hành lớp → chọn đúng lớp học → thêm giáo viên vào danh sách phân công giảng dạy của lớp; quyền sửa học liệu được tự động đồng bộ theo lớp đó.",
      },
      {
        id: "manager-faq-2",
        question: "Quản lý trung tâm có xem được học liệu đã ẩn của lớp không?",
        answer: "Các học liệu đặt ở trạng thái Đã ẩn sẽ bị khóa thao tác xem trước và tải xuống đối với những vai trò không phải giảng viên phụ trách trực tiếp của lớp.",
      },
    ],
  },
  {
    role: "SYSTEM_ADMIN",
    label: "Quản trị hệ thống",
    badge: "Hệ thống & Bảo mật",
    intro: "Quản trị toàn diện người dùng, phân quyền RBAC, cấu hình API AI/hệ thống, nhật ký audit và sao lưu khôi phục.",
    sections: [
      {
        id: "admin-rbac",
        title: "Quản lý người dùng, bàn giao và phân quyền RBAC",
        summary: "Điều phối tài khoản toàn hệ thống và tinh chỉnh quyền hạn theo từng vai trò.",
        actionHref: "/admin/users",
        actionLabel: "Mở Người dùng",
        steps: [
          {
            title: "Quản trị tài khoản và bàn giao",
            detail: "Tại Người dùng (/admin/users), tìm tài khoản cần xử lý để tạo mới, cập nhật thông tin, khóa/mở khóa hoặc bàn giao phụ trách.",
          },
          {
            title: "Cấu hình vai trò và quyền",
            detail: "Mở Vai trò & quyền (/admin/roles) để kiểm tra và điều chỉnh chi tiết từng nhóm quyền nghiệp vụ.",
          },
        ],
      },
      {
        id: "admin-settings",
        title: "Cấu hình hệ thống và tích hợp AI",
        summary: "Thiết lập tên trung tâm, múi giờ, giới hạn tệp tải lên, chế độ bảo trì và nhà cung cấp AI.",
        actionHref: "/admin/settings",
        actionLabel: "Mở Cấu hình",
        steps: [
          {
            title: "Cập nhật thông số vận hành hiện hành",
            detail: "Vào Cấu hình trên thanh điều hướng ngang, điều chỉnh giới hạn kích thước/loại tệp cho phép, thông tin trung tâm và lưu áp dụng trực tiếp.",
          },
          {
            title: "Quản lý API key AI cho quét đề và gợi ý chấm",
            detail: "Thiết lập và bật/tắt nhà cung cấp AI đang hoạt động dùng cho OCR quét ảnh đề thi và sinh gợi ý đề/chấm bài.",
          },
        ],
        tip: "Mọi thay đổi cấu hình được áp dụng trực tiếp vào cấu hình hiện hành và ghi nhận vết thao tác trong nhật ký quản trị.",
      },
      {
        id: "admin-operations",
        title: "Vận hành, Nhật ký Audit, Sao lưu & Khôi phục",
        summary: "Giám sát chỉ số sức khỏe hệ thống, tra cứu audit log, sao lưu toàn bộ và điều phối khôi phục dữ liệu.",
        actionHref: "/admin/operations",
        actionLabel: "Mở Vận hành & tuân thủ",
        steps: [
          {
            title: "Tra cứu Nhật ký hoạt động (Audit Log)",
            detail: "Trong Vận hành & tuân thủ, tìm kiếm các sự kiện thao tác quản trị theo người thực hiện, hành động hoặc đối tượng và xuất báo cáo khi cần.",
          },
          {
            title: "Theo dõi chỉ số hệ thống và hàng đợi gửi thông báo",
            detail: "Kiểm tra tình trạng cơ sở dữ liệu, hàng đợi outbox delivery và xử lý các tệp dọn dẹp bị lỗi.",
          },
          {
            title: "Chạy Sao lưu, Xuất dữ liệu và Khôi phục",
            detail: "Thực hiện tác vụ sao lưu định kỳ/thủ công, xuất gói dữ liệu hoặc tạo và phê duyệt yêu cầu khôi phục khi cần thiết.",
          },
        ],
      },
    ],
    faqs: [
      {
        id: "admin-faq-1",
        question: "Xem dấu vết ai đã thay đổi cấu hình hoặc khóa tài khoản ở đâu?",
        answer: "Mở Cấu hình → Vận hành & tuân thủ (`/admin/operations`), mục Nhật ký hoạt động ghi nhận đầy đủ các thao tác quản trị từ `audit_logs`.",
      },
      {
        id: "admin-faq-2",
        question: "Làm sao kiểm tra trạng thái hàng đợi gửi email/thông báo?",
        answer: "Tại màn hình Vận hành & tuân thủ (`/admin/operations`), bảng thống kê outbox hiển thị trực tiếp số lượt đang chờ, đã gửi hoặc lỗi thử lại.",
      },
    ],
  },
];

/** Lọc các mục hướng dẫn và câu hỏi thường gặp theo từ khóa tìm kiếm trên giao diện hiện tại. */
export function filterRoleGuide(
  guide: RoleGuideContent,
  rawQuery: string,
  translate: (text: string) => string = (text) => text,
): { sections: GuideSection[]; faqs: GuideFaqItem[] } {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return { sections: guide.sections, faqs: guide.faqs };
  }

  // Kiểm tra từ khóa tìm kiếm trên cả bản gốc tiếng Việt và bản dịch hiện hành.
  const matchesText = (value?: string) => {
    if (!value) return false;
    return value.toLowerCase().includes(query) || translate(value).toLowerCase().includes(query);
  };

  const sections = guide.sections.filter(
    (section) =>
      matchesText(section.title) ||
      matchesText(section.summary) ||
      matchesText(section.tip) ||
      section.steps.some((step) => matchesText(step.title) || matchesText(step.detail)),
  );

  const faqs = guide.faqs.filter(
    (faq) => matchesText(faq.question) || matchesText(faq.answer),
  );

  return { sections, faqs };
}
