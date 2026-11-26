import { LearningRuntimeService } from "./learning-runtime.service.js";
import { CourseClassService } from "../courses/course-class.service.js";
import { ContentMaterialService } from "../content/content-material.service.js";
import { ExamAssessmentService } from "../exams/exam-assessment.service.js";
import { EngagementSupportService } from "../engagement/engagement-support.service.js";
import { Injectable, Optional } from "@nestjs/common";
import type { ExamPage, ExamPageQuery } from "../operations/exams/learning-exam-page.js";
import type { PaginatedResult } from "../../../common/pagination.js";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import type { Environment } from "../../../config/environment.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import type { ScannedQuestionDraft } from "../../system/ai/ai-provider.service.js";
import { SystemService } from "../../system/core/system.service.js";
import type { AttachmentDocumentPreview } from "../academic/academic.shared.js";
import { type ExamGenerationContext, type MaterialAccessAction, type MaterialDownload, type MaterialSearchResult, type MaterialSummaryBucket, type QuestionSummary, type UploadedMaterialFile } from "./learning.shared.js";
import type { ClassCapabilities, ClassClosureReadiness, ClassProgressReport, ClassRoster, CourseVersionSnapshot, DirectoryUser, EnrollmentImportResult, ExamAnalytics, ExamAttempt, ExamAttemptReview, ForumPost, ForumTopic, InstructorRole, LearnerExamSummary, LearnerResult, LearningClass, LearningCourse, LearningExam, LearningMaterial, LearningNotification, LearningQuestion, LiveSession, ProgressIntervention, QuestionImportResult, RegradeRequest, RiskThresholds, SupportAttachment, SupportTicket, TicketComment } from "./learning.types.js";
import type * as classes_ops from "../operations/classes/learning-classes.js";
import type * as courses_ops from "../operations/courses/learning-courses.js";
import type * as forum_ops from "../operations/forum/learning-forum.js";
import type * as live_sessions_ops from "../operations/live/learning-live-sessions.js";
import type * as questions_ops from "../operations/questions/learning-questions.js";
import type * as support_ops from "../operations/support/learning-support.js";
export * from "./learning.shared.js";
export type { ForumPostPageResult } from "../operations/forum/learning-forum.js";

@Injectable()
/** Facade điều phối tương thích ngược của miền đào tạo, ủy quyền trọn vẹn cho 4 domain service và LearningRuntimeService. */
export class LearningService {
  private readonly runtime: LearningRuntimeService;
  private readonly courseClass: CourseClassService;
  private readonly contentMaterial: ContentMaterialService;
  private readonly examAssessment: ExamAssessmentService;
  private readonly engagementSupport: EngagementSupportService;

  constructor(
    @Optional() prisma?: PrismaService,
    @Optional() config?: ConfigService<Environment, true>,
    @Optional() objectStorage?: ObjectStorageService,
    @Optional() antivirus?: AntivirusService,
    @Optional() system?: SystemService,
    @Optional() runtime?: LearningRuntimeService,
    @Optional() courseClass?: CourseClassService,
    @Optional() contentMaterial?: ContentMaterialService,
    @Optional() examAssessment?: ExamAssessmentService,
    @Optional() engagementSupport?: EngagementSupportService,
  ) {
    this.runtime =
      runtime ??
      new LearningRuntimeService(prisma, config, objectStorage, antivirus, system);
    this.courseClass = courseClass ?? new CourseClassService(this.runtime);
    this.contentMaterial = contentMaterial ?? new ContentMaterialService(this.runtime);
    this.examAssessment = examAssessment ?? new ExamAssessmentService(this.runtime);
    this.engagementSupport = engagementSupport ?? new EngagementSupportService(this.runtime);
  }

  /** Liệt kê khóa học từ DB hoặc bộ nhớ kiểm thử. */
  async listCourses(): Promise<LearningCourse[]> {
    return await this.courseClass.listCourses();
  }

  /** Phân trang danh mục khóa học kèm tổng số bản ghi được lọc trực tiếp từ DB. */
  async listCoursesPage(
    filters: courses_ops.CoursePageFilters = {},
  ): Promise<PaginatedResult<LearningCourse>> {
    return await this.courseClass.listCoursesPage(filters);
  }

  /** Tạo khóa học nháp sau khi chuẩn hóa mã và chống trùng, đồng thời ghi audit. */
  async createCourse(
    input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes"> & {
      grade?: string | number;
      subject?: string;
    },
    actorId: string,
  ): Promise<LearningCourse> {
    return await this.courseClass.createCourse(input, actorId);
  }

  /** Cập nhật nội dung khóa học; khóa học đã xuất bản sẽ tăng version theo quy tắc lưu lịch sử. */
  async updateCourse(
    courseId: string,
    input: Pick<LearningCourse, "name" | "description" | "outcomes"> & {
      grade?: string | number;
      subject?: string;
    },
    actorId: string,
  ): Promise<LearningCourse> {
    return await this.courseClass.updateCourse(courseId, input, actorId);
  }

  /** Liệt kê snapshot xuất bản của khóa học theo thứ tự phiên bản. */
  async listCourseVersions(courseId: string): Promise<CourseVersionSnapshot[]> {
    return await this.courseClass.listCourseVersions(courseId);
  }

  /** Xuất bản khóa học và chụp snapshot bất biến của phiên bản hiện tại trong transaction. */
  async publishCourse(
    courseId: string,
    actorId: string,
  ): Promise<LearningCourse> {
    return await this.courseClass.publishCourse(courseId, actorId);
  }

  /** Chuyển khóa học sang ARCHIVED sau khi kiểm tra ràng buộc sử dụng và lưu lý do audit. */
  async archiveCourse(
    courseId: string,
    reason: string | undefined,
    actorId: string,
  ): Promise<LearningCourse> {
    return await this.courseClass.archiveCourse(courseId, reason, actorId);
  }

  /** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
  async listClasses(
    role: string,
    actorId: string,
  ): Promise<LearningClass[]> {
    return await this.courseClass.listClasses(role, actorId);
  }

  /** Đọc chi tiết đúng một lớp học theo quyền và quan hệ thành viên của phiên hiện tại. */
  async getClassById(
    classId: string,
    role: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.getClassById(classId, role, actorId);
  }

  /** Phân trang danh sách lớp học theo vai trò và bộ lọc trực tiếp ở DB. */
  async listClassesPage(
    role: string,
    actorId: string,
    filters: classes_ops.ClassPageFilters = {},
  ): Promise<PaginatedResult<LearningClass>> {
    return await this.courseClass.listClassesPage(role, actorId, filters);
  }

  /** Tính capability tại máy chủ từ quyền phiên, quan hệ lớp và trạng thái thay vì tên vai trò đơn lẻ. */
  async getClassCapabilities(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<ClassCapabilities> {
    return await this.courseClass.getClassCapabilities(classId, session);
  }

  /** Mở lớp nháp theo Khối & Môn học (hoặc từ phiên bản khóa học có sẵn) và kiểm tra lịch, sức chứa, múi giờ. */
  async createClass(
    input: classes_ops.CreateClassInput,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.createClass(input, actorId);
  }

  /** Cập nhật thông tin và cài đặt lớp học. */
  async updateClass(
    classId: string,
    input: {
      name?: string;
      capacity?: number;
      allowPeerGradeViewing?: boolean;
      allowLearnerFeedPosting?: boolean;
    },
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.updateClass(classId, input, actorId);
  }

  /** Gán giảng viên đúng role, bảo đảm người dùng có vai trò INSTRUCTOR và ghi lịch sử thành viên. */
  async assignInstructor(
    classId: string,
    instructorId: string,
    requestedRole: InstructorRole | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.assignInstructor(
      classId,
      instructorId,
      requestedRole,
      actorId,
    );
  }

  /** Bàn giao PRIMARY nguyên tử, chống hai yêu cầu đồng thời bằng người nguồn kỳ vọng. */
  async transferPrimaryInstructor(
    classId: string,
    expectedPrimaryId: string,
    newPrimaryId: string,
    rawReason: string | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.transferPrimaryInstructor(
      classId,
      expectedPrimaryId,
      newPrimaryId,
      rawReason,
      actorId,
    );
  }

  /** Gỡ phân công giảng viên và bảo vệ điều kiện giảng viên chính. */
  async removeInstructor(
    classId: string,
    instructorId: string,
    reason: string | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.removeInstructor(
      classId,
      instructorId,
      reason,
      actorId,
    );
  }

  /** Ghi danh học viên sau khi kiểm tra vai trò, trạng thái lớp, thời hạn và sức chứa. */
  async enrollLearner(
    classId: string,
    learnerId: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.enrollLearner(classId, learnerId, actorId);
  }

  /** Ghi danh lần lượt danh sách userId và cô lập lỗi để trả kết quả trên từng học viên. */
  async importEnrollments(
    classId: string,
    userIds: string[],
    actorId: string,
  ): Promise<EnrollmentImportResult[]> {
    return await this.courseClass.importEnrollments(classId, userIds, actorId);
  }

  /** Hủy ghi danh và ghi nhận lý do trực tiếp trên bản ghi ghi danh lớp. */
  async removeEnrollment(
    classId: string,
    learnerId: string,
    reason: string | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.removeEnrollment(
      classId,
      learnerId,
      reason,
      actorId,
    );
  }

  /** Tổng hợp giảng viên, ghi danh đang/cũ và lịch sử thao tác thành roster chi tiết. */
  async getClassRoster(classId: string): Promise<ClassRoster> {
    return await this.courseClass.getClassRoster(classId);
  }

  /** Kích hoạt lớp khi khóa học đã xuất bản, lịch hợp lệ và có giảng viên chính. */
  async activateClass(
    classId: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.activateClass(classId, actorId);
  }

  /** Đếm các nghiệp vụ còn mở để xác định lớp có thể đóng hay chưa. */
  async getClassClosureReadiness(
    classId: string,
  ): Promise<ClassClosureReadiness> {
    return await this.courseClass.getClassClosureReadiness(classId);
  }

  /** Đóng lớp chỉ khi readiness không còn blocker và lưu chính sách lưu trữ. */
  async closeClass(
    classId: string,
    closeReason: string | undefined,
    archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.closeClass(
      classId,
      closeReason,
      archivePolicy,
      actorId,
    );
  }

  /** Mở lại lớp đã đóng, xóa thông tin đóng và ghi lý do vào audit. */
  async reopenClass(
    classId: string,
    rawReason: string | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await this.courseClass.reopenClass(classId, rawReason, actorId);
  }

  /** Đọc hoặc tạo thư mục trong lớp được phân công. */
  async classFolders(
    classId: string,
    actorId: string,
    input: { kind: string; name: string } | undefined,
    actorRole: string,
  ): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
    return this.contentMaterial.classFolders(classId, actorId, input, actorRole);
  }

  /** Liệt kê danh sách học liệu hiển thị theo phạm vi quyền của vai trò hiện tại. */
  async listMaterials(
    role: string,
    query: string | undefined,
    actorId: string,
    page = 1,
    materialId?: string,
  ): Promise<LearningMaterial[]> {
    return await this.contentMaterial.listMaterials(role, query, actorId, page, materialId);
  }

  /** Tổng hợp nhanh số lượng học liệu theo lớp, thư mục và loại nội dung. */
  async getMaterialSummary(
    actorId: string,
    role: string,
    classId?: string,
  ): Promise<MaterialSummaryBucket[]> {
    return await this.contentMaterial.getMaterialSummary(actorId, role, classId);
  }

  /** Tìm học liệu đã công bố của học viên bằng bộ lọc và phân trang có giới hạn. */
  async searchAccessibleMaterials(
    input: {
      query?: string;
      materialId?: string;
      classId?: string;
      courseId?: string;
      scope?: string;
      visibility?: string;
      aiOnly?: boolean;
      folder?: string;
      folderExact?: boolean;
      kind?: "materials" | "lectures";
      mimeType?: string;
      tag?: string;
      page?: number;
      pageSize?: number;
    },
    learnerId: string,
    role: string,
  ): Promise<MaterialSearchResult> {
    return await this.contentMaterial.searchAccessibleMaterials(input, learnerId, role);
  }

  /** Kiểm tra quyền lớp/chính sách tệp, quét virus, lưu object và tạo version đầu tiên. */
  async createMaterial(
    classId: string | null,
    input: Pick<
      LearningMaterial,
      "name" | "mimeType" | "sizeBytes" | "folder" | "tags"
    > & { scope?: LearningMaterial["scope"]; courseId?: string; visibility?: "PUBLISHED" | "HIDDEN" },
    upload: UploadedMaterialFile | undefined,
    actorId: string,
    actorRole: string,
  ): Promise<LearningMaterial> {
    return await this.contentMaterial.createMaterial(classId, input, upload, actorId, actorRole);
  }

  /** Phát URL truy cập học liệu ký HMAC có thời hạn sau khi kiểm tra quyền. */
  async createMaterialAccess(
    materialId: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return await this.contentMaterial.createMaterialAccess(materialId, role, action, actorId);
  }

  /** Giữ API đọc bộ đệm cho tác vụ nội bộ và kiểm thử với xác minh checksum. */
  async readMaterialDownload(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
  ): Promise<MaterialDownload> {
    return await this.contentMaterial.readMaterialDownload(
      materialId,
      expires,
      signature,
      role,
      action,
      actorId,
    );
  }

  /** Chuẩn bị luồng tải học liệu trực tiếp có kiểm chứng checksum và hỗ trợ HTTP Range. */
  async readMaterialDownloadStream(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    size: number;
    totalSize: number;
    range?: ByteRange;
    fileName: string;
    mimeType: string;
  }> {
    return await this.contentMaterial.readMaterialDownloadStream(
      materialId,
      expires,
      signature,
      role,
      action,
      actorId,
      rangeHeader,
    );
  }

  /** Xác thực quyền và trích xuất nội dung xem trước (DOCX/DOC/TXT) cho học liệu. */
  async readMaterialPreviewContent(
    materialId: string,
    role: string,
    actorId: string,
  ): Promise<AttachmentDocumentPreview> {
    return await this.contentMaterial.readMaterialPreviewContent(materialId, role, actorId);
  }

  /** Cập nhật metadata/visibility của học liệu và ghi audit thay đổi. */
  async updateMaterial(
    materialId: string,
    input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility" | "scope">> & {
      classId?: string | null;
      name?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LearningMaterial> {
    return await this.contentMaterial.updateMaterial(materialId, input, actorId, actorRole);
  }

  /** Người tải lên xóa hẳn học liệu cùng mọi phiên bản và tệp. */
  async deleteMaterial(materialId: string, actorId: string, actorRole: string): Promise<void> {
    return await this.contentMaterial.deleteMaterial(materialId, actorId, actorRole);
  }

  /** Xác minh giảng viên phụ trách rồi trả học viên đang ghi danh trong lớp. */
  async listInstructorClassLearners(
    classId: string,
    instructorId: string,
  ): Promise<DirectoryUser[]> {
    return await this.courseClass.listInstructorClassLearners(classId, instructorId);
  }

  /** Tìm người dùng theo vai trò và tùy chọn loại các thành viên đã thuộc lớp. */
  async searchDirectory(
    roleCode: "INSTRUCTOR" | "LEARNER",
    query = "",
    classId?: string,
  ): Promise<DirectoryUser[]> {
    return await this.courseClass.searchDirectory(roleCode, query, classId);
  }

  /** Quét và thay trực tiếp tệp hiện tại của học liệu, xóa ngay tệp cũ sau khi lưu xong. */
  async replaceMaterialFile(
    materialId: string,
    input: Pick<LearningMaterial, "folder" | "tags">,
    upload: UploadedMaterialFile,
    actorId: string,
  ): Promise<LearningMaterial> {
    return await this.contentMaterial.replaceMaterialFile(materialId, input, upload, actorId);
  }

  /** Lọc phiên bản câu hỏi mới nhất theo từ khóa, khóa học, loại, độ khó, tag và trạng thái. */
  async listQuestions(
    filters: string | questions_ops.QuestionListFilters,
    scope: questions_ops.QuestionScope,
  ): Promise<LearningQuestion[]> {
    return await this.examAssessment.listQuestions(filters, scope);
  }

  /** Phân trang phiên bản mới nhất mỗi family câu hỏi trực tiếp bằng SQL CTE trong phạm vi của người gọi. */
  async listQuestionsPage(
    filters: questions_ops.QuestionPageFilters,
    scope: questions_ops.QuestionScope,
  ): Promise<PaginatedResult<LearningQuestion>> {
    return await this.examAssessment.listQuestionsPage(filters, scope);
  }

  /** Thống kê nhanh tổng câu hỏi, trắc nghiệm và tự luận theo từng khóa học trong phạm vi của người gọi. */
  async getQuestionSummary(courseId: string | undefined, scope: questions_ops.QuestionScope): Promise<QuestionSummary> {
    return await this.examAssessment.getQuestionSummary(courseId, scope);
  }

  /** Validate nội dung/đáp án, tạo family câu hỏi và chọn trạng thái theo chế độ duyệt cấu hình. */
  async createQuestion(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId: string,
  ): Promise<LearningQuestion> {
    return await this.examAssessment.createQuestion(input, authorId);
  }

  /** Tạo version kế tiếp của câu hỏi thay vì sửa bản đã dùng, đồng thời chống nội dung trùng. */
  async updateQuestion(
    questionId: string,
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId: string,
  ): Promise<LearningQuestion> {
    return await this.examAssessment.updateQuestion(questionId, input, authorId);
  }

  /** Kiểm tra ảnh thật, lưu object mới và dọn ảnh cũ khi không còn version nào tham chiếu. */
  async uploadQuestionImage(
    questionId: string,
    upload: UploadedMaterialFile,
    actorId: string,
  ): Promise<LearningQuestion> {
    return await this.examAssessment.uploadQuestionImage(questionId, upload, actorId);
  }

  /** Xóa liên kết ảnh của câu hỏi rồi dọn object nếu không còn tham chiếu. */
  async removeQuestionImage(questionId: string, actorId: string): Promise<LearningQuestion> {
    return await this.examAssessment.removeQuestionImage(questionId, actorId);
  }

  /** Cho người quản lý hoặc thành viên đề/lớp hợp lệ đọc ảnh câu hỏi mà không lộ object key. */
  async readQuestionImage(
    questionId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    return await this.examAssessment.readQuestionImage(questionId, role, actorId);
  }

  /** Nhập từng câu độc lập để lỗi một mục không hủy toàn bộ lô. */
  async importQuestions(
    inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
    authorId: string,
  ): Promise<QuestionImportResult[]> {
    return await this.examAssessment.importQuestions(inputs, authorId);
  }

  /** Liệt kê đề theo vai trò và quan hệ lớp, không trả đề ngoài phạm vi giảng dạy/ghi danh. */
  async listExams(role: string, actorId: string): Promise<LearningExam[]> {
    return await this.examAssessment.listExams(role, actorId);
  }

  /** Phân trang đề tại database và giữ nguyên kiểm tra phạm vi lớp của người đang đăng nhập. */
  async listExamPage(role: string, actorId: string, query: ExamPageQuery): Promise<ExamPage> {
    return this.examAssessment.listExamPage(role, actorId, query);
  }

  /** Ghép đề đã công bố với số lượt và thời gian để tính trạng thái khả dụng cho học viên. */
  async listLearnerExamSummaries(
    classId: string | undefined,
    learnerId: string,
  ): Promise<LearnerExamSummary[]> {
    return await this.examAssessment.listLearnerExamSummaries(classId, learnerId);
  }

  /** Trả câu hỏi cho học viên theo thứ tự seed nếu xáo trộn và loại dữ liệu đáp án đúng. */
  async getExamQuestions(examId: string, learnerId: string): Promise<LearningQuestion[]> {
    return await this.examAssessment.getExamQuestions(examId, learnerId);
  }

  /** Xác minh giảng viên phụ trách rồi trả câu hỏi theo đúng thứ tự gốc của đề. */
  async getInstructorExamPreview(
    examId: string,
    instructorId: string,
  ): Promise<LearningQuestion[]> {
    return await this.examAssessment.getInstructorExamPreview(examId, instructorId);
  }

  /** Trả nội dung đề cho quản lý duyệt, chỉ khi đề đang ở hàng chờ phê duyệt. */
  async getReviewerExamPreview(examId: string, actorId: string): Promise<LearningQuestion[]> {
    return await this.examAssessment.getReviewerExamPreview(examId, actorId);
  }

  /** Validate lịch/thang điểm/câu hỏi, giữ thứ tự chọn và tạo đề nháp cho lớp phụ trách. */
  async createExam(
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & { scoreAllocations?: Array<{ questionId: string; score: number }> },
    actorId: string,
  ): Promise<LearningExam> {
    return await this.examAssessment.createExam(input, actorId);
  }

  /** Thay nội dung đề DRAFT nguyên tử, tăng version và từ chối bản chỉnh sửa đã cũ. */
  async updateExam(
    examId: string,
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & {
      scoreAllocations?: Array<{ questionId: string; score: number }>;
      expectedVersion: number;
    },
    actorId: string,
  ): Promise<LearningExam> {
    return await this.examAssessment.updateExam(examId, input, actorId);
  }

  /** Sửa câu trong đề nháp bằng bản sao riêng; giữ nguyên các đề đang dùng câu gốc. */
  async editExamQuestion(
    examId: string,
    questionId: string,
    input: {
      content: string;
      options: string[];
      correctAnswers: string[];
      expectedVersion: number;
    },
    actorId: string,
  ): Promise<LearningQuestion> {
    return await this.examAssessment.editExamQuestion(examId, questionId, input, actorId);
  }

  /** Kiểm tra đề hoàn chỉnh rồi tự công bố hoặc đưa vào hàng đợi duyệt theo cấu hình. */
  async submitExamForReview(
    examId: string,
    actorId: string,
    confirmQuestions = false,
    expectedVersion?: number,
    forcePublish = false,
  ): Promise<LearningExam> {
    return await this.examAssessment.submitExamForReview(
      examId,
      actorId,
      confirmQuestions,
      expectedVersion,
      forcePublish,
    );
  }

  /** Kiểm tra ghi danh, cửa sổ thi, giới hạn lượt rồi tạo hoặc tiếp tục lượt đang làm. */
  async startAttempt(examId: string, learnerId: string): Promise<ExamAttempt> {
    return await this.examAssessment.startAttempt(examId, learnerId);
  }

  /** Validate đáp án thuộc đề và upsert câu trả lời khi lượt thi còn trong hạn. */
  async saveAnswer(
    attemptId: string,
    questionId: string,
    answers: string[],
    learnerId: string,
  ): Promise<ExamAttempt> {
    return await this.examAssessment.saveAnswer(attemptId, questionId, answers, learnerId);
  }

  /** Lưu gộp đáp án cuối cùng rồi nộp bài. */
  async submitAttemptWithAnswers(
    attemptId: string,
    learnerId: string,
    answers: Array<{ questionId: string; answers: string[] }> = [],
  ): Promise<ExamAttempt> {
    return this.examAssessment.submitAttemptWithAnswers(attemptId, learnerId, answers);
  }

  /** Chốt lượt thi nguyên tử, tự chấm câu khách quan và phát receipt chống nhầm lẫn. */
  async submitAttempt(
    attemptId: string,
    learnerId: string,
    trigger: "LEARNER" | "SYSTEM" = "LEARNER",
  ): Promise<ExamAttempt> {
    return await this.examAssessment.submitAttempt(attemptId, learnerId, trigger);
  }

  /** Tìm lượt IN_PROGRESS quá hạn theo lô và nộp tự động bằng cùng logic submit. */
  async reconcileExpiredAttempts(limit = 100): Promise<number> {
    return await this.examAssessment.reconcileExpiredAttempts(limit);
  }

  /** Đọc một lượt thi và ánh xạ đáp án từ Prisma hoặc kho nhớ. */
  async getAttempt(attemptId: string): Promise<ExamAttempt> {
    return await this.examAssessment.getAttempt(attemptId);
  }

  /** Liệt kê kết quả đã nộp/chấm của học viên cùng trạng thái phúc khảo. */
  async listLearnerResults(learnerId: string): Promise<LearnerResult[]> {
    return await this.examAssessment.listLearnerResults(learnerId);
  }

  /** Trả đúng kết quả thuộc học viên, từ chối truy cập chéo lượt thi. */
  async getLearnerResult(attemptId: string, learnerId: string): Promise<LearnerResult> {
    return await this.examAssessment.getLearnerResult(attemptId, learnerId);
  }

  /** Mở yêu cầu phúc khảo duy nhất cho lượt đã chấm và thông báo giảng viên. */
  async requestRegrade(
    attemptId: string,
    reason: string,
    learnerId: string,
  ): Promise<RegradeRequest> {
    return await this.examAssessment.requestRegrade(attemptId, reason, learnerId);
  }

  /** Liệt kê hàng đợi phúc khảo trong đúng phạm vi lớp của giảng viên. */
  async listRegradeRequests(
    actorId: string,
    status?: RegradeRequest["status"],
  ): Promise<RegradeRequest[]> {
    return await this.examAssessment.listRegradeRequests(actorId, status);
  }

  /** Nhả yêu cầu phúc khảo mình đang xử lý về hàng đợi. */
  async releaseRegrade(requestId: string, actorId: string): Promise<RegradeRequest> {
    return await this.examAssessment.releaseRegrade(requestId, actorId);
  }

  /** Nhận xử lý một yêu cầu OPEN bằng cập nhật có điều kiện để chống hai người cùng nhận. */
  async claimRegrade(requestId: string, actorId: string): Promise<RegradeRequest> {
    return await this.examAssessment.claimRegrade(requestId, actorId);
  }

  /** Kết thúc yêu cầu đã nhận; nếu chấp thuận thì cập nhật điểm hiện hành. */
  async resolveRegrade(
    requestId: string,
    input: {
      decision: "APPROVE" | "REJECT";
      resolution: string;
      score?: number;
      feedback?: string;
      questionScores?: Array<{ questionId: string; score: number }>;
    },
    actorId: string,
  ): Promise<RegradeRequest> {
    return await this.examAssessment.resolveRegrade(requestId, input, actorId);
  }

  /** Liệt kê lượt thi trong phạm vi lớp giảng viên phụ trách. */
  async listAttempts(examId: string | undefined, actorId: string): Promise<ExamAttempt[]> {
    return await this.examAssessment.listAttempts(examId, actorId);
  }

  /** Thu thập tối đa sáu tệp đã công khai trong các lớp cùng môn mà giảng viên được phân công. */
  async getExamGenerationContext(
    classId: string,
    actorId: string,
    rawMaterialIds: string[] = [],
    skipMaterials = false,
  ): Promise<ExamGenerationContext> {
    return await this.examAssessment.getExamGenerationContext(
      classId,
      actorId,
      rawMaterialIds,
      skipMaterials,
    );
  }

  /** Tìm đề đã hoàn tất theo khóa idempotency trước khi gọi lại provider AI. */
  async getGeneratedExamByRequest(
    clientRequestId: string,
    classId: string,
    actorId: string,
  ): Promise<LearningExam | undefined> {
    return await this.examAssessment.getGeneratedExamByRequest(clientRequestId, classId, actorId);
  }

  /** Lưu câu hỏi AI đã chuẩn hóa và đề nháp trong một giao dịch, tái dùng câu trùng đã xuất bản. */
  async createGeneratedExam(
    input: Omit<LearningExam, "id" | "status" | "version" | "questionIds">,
    questions: ScannedQuestionDraft[],
    courseId: string,
    generationContext: {
      mode: "COURSE_MATERIALS" | "WEB_SEARCH";
      materialIds: string[];
      sources: Array<{ title: string; url: string }>;
      providerId?: string;
      provider?: string;
      model?: string;
      warnings?: string[];
    },
    clientRequestId: string = randomUUID(),
    actorId: string,
  ): Promise<LearningExam> {
    return await this.examAssessment.createGeneratedExam(
      input,
      questions,
      courseId,
      generationContext,
      clientRequestId,
      actorId,
    );
  }

  /** Trả đầy đủ đề, bài làm và điểm từng câu sau khi xác minh phạm vi giảng viên. */
  async getAttemptReview(attemptId: string, actorId: string): Promise<ExamAttemptReview> {
    return await this.examAssessment.getAttemptReview(attemptId, actorId);
  }

  /** Ghi điểm thủ công/hiệu chỉnh, bắt buộc lý do khi đổi điểm và cập nhật điểm hiện hành. */
  async gradeAttempt(
    attemptId: string,
    score: number,
    feedback: string,
    correctionReason: string | undefined,
    graderId: string,
    questionScores?: Array<{ questionId: string; score: number }>,
  ): Promise<ExamAttempt> {
    return await this.examAssessment.gradeAttempt(
      attemptId,
      score,
      feedback,
      correctionReason,
      graderId,
      questionScores,
    );
  }


  /** Liệt kê chủ đề theo lớp truy cập được, ưu tiên chủ đề ghim rồi mới theo cập nhật. */
  async listTopics(role: string, actorId: string): Promise<ForumTopic[]> {
    return await this.engagementSupport.listTopics(role, actorId);
  }

  /** Phân trang chủ đề diễn đàn trực tiếp từ DB kèm bộ lọc lớp, ghim, bài của tôi và từ khóa. */
  async listTopicsPage(
    role: string,
    actorId: string,
    filters: forum_ops.ForumTopicPageFilters = {},
  ): Promise<PaginatedResult<ForumTopic>> {
    return await this.engagementSupport.listTopicsPage(role, actorId, filters);
  }

  /** Kiểm tra thành viên/chính sách nội dung rồi tạo chủ đề và thông báo thành viên lớp. */
  async createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId: string,
    authorRole = authorId === "usr-learner" ? "LEARNER" : "INSTRUCTOR",
  ): Promise<ForumTopic> {
    return await this.engagementSupport.createTopic(classId, input, authorId, authorRole);
  }

  /** Ghim hoặc khóa chủ đề và ghi audit người điều phối. */
  async moderateTopic(
    topicId: string,
    input: { isLocked?: boolean; isPinned?: boolean; reason?: string },
    actorId: string,
  ): Promise<ForumTopic> {
    return await this.engagementSupport.moderateTopic(topicId, input, actorId);
  }

  /** Kiểm tra quyền lớp rồi trả cây bài viết, ẩn nội dung đã xóa/kiểm duyệt phù hợp. */
  async listPosts(topicId: string, role: string, actorId: string): Promise<ForumPost[]> {
    return await this.engagementSupport.listPosts(topicId, role, actorId);
  }

  /** Phân trang bình luận gốc của chủ đề kèm đầy đủ phản hồi thuộc từng gốc đó. */
  async listPostsPage(
    topicId: string,
    role: string,
    actorId: string,
    filters: { page?: number; pageSize?: number } = {},
  ): Promise<forum_ops.ForumPostPageResult> {
    return await this.engagementSupport.listPostsPage(topicId, role, actorId, filters);
  }

  /** Validate nội dung, chủ đề chưa khóa, parent/tệp/mention hợp lệ rồi tạo post và thông báo. */
  async createPost(
    topicId: string,
    body: string,
    authorId: string,
    parentId?: string,
    rawAttachmentIds: string[] = [],
    rawMentionedUserIds: string[] = [],
  ): Promise<ForumPost> {
    return await this.engagementSupport.createPost(
      topicId,
      body,
      authorId,
      parentId,
      rawAttachmentIds,
      rawMentionedUserIds,
    );
  }

  /** Cho đúng tác giả sửa bài chưa bị xóa/ẩn và chạy lại chính sách nội dung. */
  async updatePost(postId: string, body: string, authorId: string): Promise<ForumPost> {
    return await this.engagementSupport.updatePost(postId, body, authorId);
  }

  /** Xóa mềm bài viết của tác giả để giữ tính toàn vẹn chuỗi thảo luận. */
  async deletePost(postId: string, authorId: string): Promise<ForumPost> {
    return await this.engagementSupport.deletePost(postId, authorId);
  }

  /** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất. */
  async listNotifications(recipientId: string): Promise<LearningNotification[]> {
    return await this.engagementSupport.listNotifications(recipientId);
  }

  /** Đánh dấu toàn bộ thông báo của người nhận là đã đọc và trả danh sách mới. */
  async markAllNotificationsRead(recipientId: string): Promise<LearningNotification[]> {
    return await this.engagementSupport.markAllNotificationsRead(recipientId);
  }

  /** Đánh dấu đã đọc bằng điều kiện recipientId để ngăn sửa thông báo người khác. */
  async markNotificationRead(
    notificationId: string,
    recipientId: string,
  ): Promise<LearningNotification> {
    return await this.engagementSupport.markNotificationRead(notificationId, recipientId);
  }

  /** Liệt kê buổi trực tuyến theo quan hệ lớp và trạng thái truy cập của vai trò. */
  async listSessions(role: string, actorId: string): Promise<LiveSession[]> {
    return await this.engagementSupport.listSessions(role, actorId);
  }

  /** Phân trang buổi học trực tuyến theo lớp, trạng thái và khoảng thời gian trên DB. */
  async listSessionsPage(
    role: string,
    actorId: string,
    filters: live_sessions_ops.LiveSessionPageFilters = {},
  ): Promise<PaginatedResult<LiveSession>> {
    return await this.engagementSupport.listSessionsPage(role, actorId, filters);
  }

  /** Validate lịch/quyền lớp, lưu link Google Meet hoặc cấp phòng từ provider có fallback rồi thông báo thành viên. */
  async createSession(
    classId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      meetingUrl?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await this.engagementSupport.createSession(classId, input, actorId, actorRole);
  }

  /** Cập nhật lịch và liên kết phòng họp trước khi buổi học diễn ra và lưu lý do audit. */
  async updateSession(
    sessionId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      reason?: string;
      meetingUrl?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await this.engagementSupport.updateSession(sessionId, input, actorId, actorRole);
  }

  /** Hủy buổi chưa hoàn tất, ghi lý do và gửi thông báo tới lớp. */
  async cancelSession(
    sessionId: string,
    reason: string | undefined,
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await this.engagementSupport.cancelSession(sessionId, reason, actorId, actorRole);
  }

  /** Kiểm soát chuyển trạng thái buổi học và cập nhật mốc vận hành liên quan. */
  async transitionSession(
    sessionId: string,
    status: LiveSession["status"],
    actorId: string,
  ): Promise<LiveSession> {
    return await this.engagementSupport.transitionSession(sessionId, status, actorId);
  }

  /** Xác minh ghi danh/quyền lớp/cửa sổ tham dự và trả URL phòng họp hợp lệ. */
  async joinSession(
    sessionId: string,
    actorId: string,
    actorRole: string,
  ): Promise<{ attendeeUrl: string; joinedAt: string }> {
    return await this.engagementSupport.joinSession(sessionId, actorId, actorRole);
  }

  /** Gắn nguồn bản ghi cho buổi đã hoàn tất và chuyển sang trạng thái xử lý. */
  async attachRecording(
    sessionId: string,
    recordingUrl: string,
    actorId: string,
  ): Promise<LiveSession> {
    return await this.engagementSupport.attachRecording(sessionId, recordingUrl, actorId);
  }

  /** Chốt xử lý bản ghi, tính ngày hết hạn hoặc lưu lỗi và thông báo học viên khi sẵn sàng. */
  async completeRecording(
    sessionId: string,
    status: "READY" | "FAILED",
    retentionDays = 90,
    errorMessage: string | undefined,
    actorId: string,
  ): Promise<LiveSession> {
    return await this.engagementSupport.completeRecording(
      sessionId,
      status,
      retentionDays,
      errorMessage,
      actorId,
    );
  }

  /** Trả tóm tắt buổi học và khả năng xem bản ghi của học viên. */
  async getSessionSummary(sessionId: string, learnerId: string): Promise<object> {
    return await this.engagementSupport.getSessionSummary(sessionId, learnerId);
  }

  /** Phát URL nội bộ ký theo session, learner và hạn để bảo vệ bản ghi. */
  async createRecordingAccess(
    sessionId: string,
    learnerId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return await this.engagementSupport.createRecordingAccess(sessionId, learnerId);
  }

  /** Xác minh chữ ký/hạn/quyền học viên rồi mới trả URL provider thực. */
  async resolveRecordingAccess(
    sessionId: string,
    expires: number,
    signature: string,
    learnerId: string,
  ): Promise<{ recordingUrl: string }> {
    return await this.engagementSupport.resolveRecordingAccess(
      sessionId,
      expires,
      signature,
      learnerId,
    );
  }

  /** Liệt kê tất cả phiếu cho nhân sự hỗ trợ hoặc chỉ phiếu của người gửi. */
  async listTickets(role: string, actorId: string): Promise<SupportTicket[]> {
    return await this.engagementSupport.listTickets(role, actorId);
  }

  /** Phân trang danh sách phiếu hỗ trợ theo vai trò, trạng thái và từ khóa. */
  async listTicketsPage(
    role: string,
    actorId: string,
    filters: support_ops.SupportTicketPageFilters = {},
  ): Promise<PaginatedResult<SupportTicket>> {
    return await this.engagementSupport.listTicketsPage(role, actorId, filters);
  }

  /** Validate nội dung, chống phiếu trùng đang mở và tạo SLA theo mức độ nghiêm trọng. */
  async createTicket(
    input: Pick<
      SupportTicket,
      "category" | "severity" | "description" | "contextId"
    > & { clientRequestId?: string },
    reporterId: string,
  ): Promise<SupportTicket> {
    return await this.engagementSupport.createTicket(input, reporterId);
  }

  /** Adapter tương thích cũ ánh xạ vai trò demo sang userId để đọc thông báo. */
  listRoleNotifications(role: string): Promise<LearningNotification[]> {
    return this.engagementSupport.listRoleNotifications(role);
  }

  /** Adapter tương thích cũ đánh dấu thông báo theo userId mặc định của vai trò. */
  markRoleNotificationRead(
    notificationId: string,
    role: string,
  ): Promise<LearningNotification> {
    return this.engagementSupport.markRoleNotificationRead(notificationId, role);
  }

  /** Kiểm tra quyền phiếu, magic bytes/virus rồi lưu tệp bằng chứng và metadata. */
  async addSupportAttachment(
    ticketId: string,
    upload: UploadedMaterialFile,
    role: string,
    uploaderId: string,
  ): Promise<SupportAttachment> {
    return await this.engagementSupport.addSupportAttachment(ticketId, upload, role, uploaderId);
  }

  /** Trả bytes bằng chứng cho đúng người gửi hoặc vai trò quản lý hỗ trợ. */
  async readSupportAttachment(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    return await this.engagementSupport.readSupportAttachment(ticketId, attachmentId, role, actorId);
  }

  /** Mở luồng tải bằng chứng hỗ trợ có hỗ trợ HTTP Range và kiểm chứng checksum. */
  async readSupportAttachmentStream(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    totalSize: number;
    range?: ByteRange;
    fileName: string;
    mimeType: string;
  }> {
    return await this.engagementSupport.readSupportAttachmentStream(
      ticketId,
      attachmentId,
      role,
      actorId,
      rangeHeader,
    );
  }

  /** Cập nhật người phụ trách/trạng thái/kết quả và ghi audit chuyển trạng thái. */
  async updateTicket(
    ticketId: string,
    input: Partial<
      Pick<SupportTicket, "status" | "assigneeId" | "resolution">
    > & { expectedUpdatedAt?: string },
    actorId: string,
  ): Promise<SupportTicket> {
    return await this.engagementSupport.updateTicket(ticketId, input, actorId);
  }

  /** Cho đúng người gửi đóng phiếu chưa hoàn tất và ghi mốc đóng. */
  async closeTicketByReporter(
    ticketId: string,
    reporterId: string,
  ): Promise<SupportTicket> {
    return await this.engagementSupport.closeTicketByReporter(ticketId, reporterId);
  }

  /** Kiểm tra người gửi hoặc quyền hỗ trợ trước khi trả trao đổi của phiếu. */
  async listTicketComments(
    ticketId: string,
    role: string,
    actorId: string,
  ): Promise<TicketComment[]> {
    return await this.engagementSupport.listTicketComments(ticketId, role, actorId);
  }

  /** Thêm trao đổi hợp lệ vào phiếu truy cập được và cập nhật thời gian hoạt động. */
  async addTicketComment(
    ticketId: string,
    body: string,
    role: string,
    authorId: string,
  ): Promise<TicketComment> {
    return await this.engagementSupport.addTicketComment(ticketId, body, role, authorId);
  }

  /** Tổng hợp điểm số, hoàn thành học liệu và sinh phân loại rủi ro từng học viên. */
  async getClassProgress(
    classId: string,
    input: { from?: string; to?: string } & Partial<RiskThresholds>,
    actorId: string,
    actorRole: string,
  ): Promise<ClassProgressReport> {
    return await this.engagementSupport.getClassProgress(classId, input, actorId, actorRole);
  }

  /** Tạo kế hoạch can thiệp, giao đúng giảng viên của lớp và lưu riêng người tạo. */
  async createProgressIntervention(
    classId: string,
    input: Pick<
      ProgressIntervention,
      "learnerId" | "title" | "notes" | "dueAt"
    > & { assigneeId: string },
    createdById: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await this.engagementSupport.createProgressIntervention(
      classId,
      input,
      createdById,
      actorRole,
    );
  }

  /** Liệt kê hành động hỗ trợ đang thuộc trách nhiệm của người dùng hiện tại. */
  async listMyProgressInterventions(ownerId: string): Promise<ProgressIntervention[]> {
    return await this.engagementSupport.listMyProgressInterventions(ownerId);
  }

  /** Nhận, hoàn tất hoặc hủy hành động hỗ trợ theo quyền sở hữu và điều kiện kết quả. */
  async updateProgressIntervention(
    interventionId: string,
    input: {
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
      outcome?: string;
      cancellationReason?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await this.engagementSupport.updateProgressIntervention(
      interventionId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Bàn giao hành động đang mở cho giảng viên khác và lưu toàn bộ dấu vết chuyển giao. */
  async transferProgressIntervention(
    interventionId: string,
    assigneeId: string,
    rawReason: string | undefined,
    actorId: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await this.engagementSupport.transferProgressIntervention(
      interventionId,
      assigneeId,
      rawReason,
      actorId,
      actorRole,
    );
  }

  /** Phân tích phân bố điểm, tỷ lệ hoàn thành và hiệu suất câu hỏi trong phạm vi giảng viên. */
  async getExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId: string,
  ): Promise<ExamAnalytics> {
    return await this.examAssessment.getExamAnalytics(input, actorId);
  }

  /** Chuyển dữ liệu phân tích đề thi sang CSV có BOM để Excel đọc Unicode đúng. */
  async exportExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId: string,
  ): Promise<Buffer> {
    return await this.examAssessment.exportExamAnalytics(input, actorId);
  }

  /** Cung cấp giới hạn tệp hiện hành cho trình chọn học liệu của giảng viên. */
  async getMaterialUploadPolicy(): Promise<{ maxFileSizeMb: number; allowedMimeTypes: string[] }> {
    return await this.contentMaterial.getMaterialUploadPolicy();
  }
}
