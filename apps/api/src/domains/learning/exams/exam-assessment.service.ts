import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PaginatedResult } from "../../../common/pagination.js";
import type { ScannedQuestionDraft } from "../../system/ai/ai-provider.service.js";
import { LearningRuntimeService } from "../core/learning-runtime.service.js";
import type {
  ExamGenerationContext,
  MaterialDownload,
  QuestionSummary,
  UploadedMaterialFile,
} from "../core/learning.shared.js";
import type {
  ExamAnalytics,
  ExamAttempt,
  ExamAttemptReview,
  LearnerExamSummary,
  LearnerResult,
  LearningExam,
  LearningQuestion,
  QuestionImportResult,
  RegradeRequest,
} from "../core/learning.types.js";
import * as analytics_ops from "../operations/analytics/learning-analytics.js";
import * as attempts_ops from "../operations/exams/learning-attempts.js";
import * as exam_approval_ops from "../operations/exams/learning-exam-approval.js";
import * as exam_editing_ops from "../operations/exams/learning-exam-editing.js";
import * as exam_generation_ops from "../operations/exams/learning-exam-generation.js";
import {
  listExamPage,
  type ExamPage,
  type ExamPageQuery,
} from "../operations/exams/learning-exam-page.js";
import * as exams_ops from "../operations/exams/learning-exams.js";
import * as grading_ops from "../operations/grading/learning-grading.js";
import * as regrades_ops from "../operations/grading/learning-regrades.js";
import * as questions_ops from "../operations/questions/learning-questions.js";

@Injectable()
/** Service miền ngân hàng câu hỏi, đề kiểm tra, lượt thi, chấm bài, phúc khảo và phân tích đề. */
export class ExamAssessmentService {
  private readonly runtime: LearningRuntimeService;

  constructor(@Optional() runtime?: LearningRuntimeService) {
    this.runtime = runtime ?? new LearningRuntimeService();
  }

  /** Lọc phiên bản câu hỏi mới nhất theo từ khóa, khóa học, loại, độ khó, tag và trạng thái. */
  async listQuestions(
    filters: string | questions_ops.QuestionListFilters,
    scope: questions_ops.QuestionScope,
  ): Promise<LearningQuestion[]> {
    return await questions_ops.listQuestions(this.runtime.context, filters, scope);
  }

  /** Phân trang phiên bản mới nhất mỗi family câu hỏi trực tiếp bằng SQL CTE trong phạm vi người gọi. */
  async listQuestionsPage(
    filters: questions_ops.QuestionPageFilters,
    scope: questions_ops.QuestionScope,
  ): Promise<PaginatedResult<LearningQuestion>> {
    return await questions_ops.listQuestionsPage(this.runtime.context, filters, scope);
  }

  /** Thống kê nhanh tổng câu hỏi, trắc nghiệm và tự luận theo từng khóa học trong phạm vi người gọi. */
  async getQuestionSummary(
    courseId: string | undefined,
    scope: questions_ops.QuestionScope,
  ): Promise<QuestionSummary> {
    return await questions_ops.getQuestionSummary(this.runtime.context, courseId, scope);
  }

  /** Validate nội dung/đáp án, tạo family câu hỏi và chọn trạng thái theo chế độ duyệt. */
  async createQuestion(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId: string,
  ): Promise<LearningQuestion> {
    return await questions_ops.createQuestion(this.runtime.context, input, authorId);
  }

  /** Tạo version kế tiếp của câu hỏi thay vì sửa bản đã dùng, đồng thời chống nội dung trùng. */
  async updateQuestion(
    questionId: string,
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId: string,
  ): Promise<LearningQuestion> {
    return await questions_ops.updateQuestion(this.runtime.context, questionId, input, authorId);
  }

  /** Kiểm tra ảnh thật, lưu object mới và dọn ảnh cũ khi không còn version nào tham chiếu. */
  async uploadQuestionImage(
    questionId: string,
    upload: UploadedMaterialFile,
    actorId: string,
  ): Promise<LearningQuestion> {
    return await questions_ops.uploadQuestionImage(
      this.runtime.context,
      questionId,
      upload,
      actorId,
    );
  }

  /** Xóa liên kết ảnh của câu hỏi rồi dọn object nếu không còn tham chiếu. */
  async removeQuestionImage(questionId: string, actorId: string): Promise<LearningQuestion> {
    return await questions_ops.removeQuestionImage(this.runtime.context, questionId, actorId);
  }

  /** Cho người quản lý hoặc thành viên đề/lớp hợp lệ đọc ảnh câu hỏi mà không lộ object key. */
  async readQuestionImage(
    questionId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    return await questions_ops.readQuestionImage(this.runtime.context, questionId, role, actorId);
  }

  /** Nhập từng câu độc lập để lỗi một mục không hủy toàn bộ lô. */
  async importQuestions(
    inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
    authorId: string,
  ): Promise<QuestionImportResult[]> {
    return await questions_ops.importQuestions(this.runtime.context, inputs, authorId);
  }

  /** Liệt kê đề theo vai trò và quan hệ lớp, không trả đề ngoài phạm vi giảng dạy/ghi danh. */
  async listExams(role: string, actorId: string): Promise<LearningExam[]> {
    return await exams_ops.listExams(this.runtime.context, role, actorId);
  }

  /** Phân trang đề tại database và giữ nguyên kiểm tra phạm vi lớp của người đang đăng nhập. */
  async listExamPage(role: string, actorId: string, query: ExamPageQuery): Promise<ExamPage> {
    return listExamPage(this.runtime.context, role, actorId, query);
  }

  /** Ghép đề đã công bố với số lượt và thời gian để tính trạng thái khả dụng cho học viên. */
  async listLearnerExamSummaries(
    classId: string | undefined,
    learnerId: string,
  ): Promise<LearnerExamSummary[]> {
    return await exams_ops.listLearnerExamSummaries(this.runtime.context, classId, learnerId);
  }

  /** Trả câu hỏi cho học viên theo thứ tự seed nếu xáo trộn và loại dữ liệu đáp án đúng. */
  async getExamQuestions(examId: string, learnerId: string): Promise<LearningQuestion[]> {
    return await exams_ops.getExamQuestions(this.runtime.context, examId, learnerId);
  }

  /** Xác minh giảng viên phụ trách rồi trả câu hỏi theo đúng thứ tự gốc của đề. */
  async getInstructorExamPreview(
    examId: string,
    instructorId: string,
  ): Promise<LearningQuestion[]> {
    return await exams_ops.getInstructorExamPreview(this.runtime.context, examId, instructorId);
  }

  /** Trả nội dung đề cho quản lý duyệt và ghi audit truy cập đáp án. */
  async getReviewerExamPreview(examId: string, actorId: string): Promise<LearningQuestion[]> {
    return await exams_ops.getReviewerExamPreview(this.runtime.context, examId, actorId);
  }

  /** Validate lịch/thang điểm/câu hỏi, giữ thứ tự chọn và tạo đề nháp cho lớp phụ trách. */
  async createExam(
    input: Omit<LearningExam, "id" | "status" | "version" | "questionScores" | "aiContext"> & {
      scoreAllocations?: Array<{ questionId: string; score: number }>;
    },
    actorId: string,
  ): Promise<LearningExam> {
    return await exam_editing_ops.createExam(this.runtime.context, input, actorId);
  }

  /** Thay nội dung đề DRAFT nguyên tử, tăng version và từ chối bản chỉnh sửa đã cũ. */
  async updateExam(
    examId: string,
    input: Omit<LearningExam, "id" | "status" | "version" | "questionScores" | "aiContext"> & {
      scoreAllocations?: Array<{ questionId: string; score: number }>;
      expectedVersion: number;
    },
    actorId: string,
  ): Promise<LearningExam> {
    return await exam_editing_ops.updateExam(this.runtime.context, examId, input, actorId);
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
    return await exam_editing_ops.editExamQuestion(
      this.runtime.context,
      examId,
      questionId,
      input,
      actorId,
    );
  }

  /** Kiểm tra đề hoàn chỉnh rồi tự công bố hoặc đưa vào hàng đợi duyệt theo cấu hình. */
  async submitExamForReview(
    examId: string,
    actorId: string,
    confirmQuestions = false,
    expectedVersion?: number,
    forcePublish = false,
  ): Promise<LearningExam> {
    return await exam_approval_ops.submitExamForReview(
      this.runtime.context,
      examId,
      actorId,
      confirmQuestions,
      expectedVersion,
      forcePublish,
    );
  }

  /** Kiểm tra ghi danh, cửa sổ thi, giới hạn lượt rồi tạo hoặc tiếp tục lượt đang làm. */
  async startAttempt(examId: string, learnerId: string): Promise<ExamAttempt> {
    return await attempts_ops.startAttempt(this.runtime.context, examId, learnerId);
  }

  /** Validate đáp án thuộc đề và upsert câu trả lời khi lượt thi còn trong hạn. */
  async saveAnswer(
    attemptId: string,
    questionId: string,
    answers: string[],
    learnerId: string,
  ): Promise<ExamAttempt> {
    return await attempts_ops.saveAnswer(
      this.runtime.context,
      attemptId,
      questionId,
      answers,
      learnerId,
    );
  }

  /** Lưu gộp đáp án cuối cùng rồi nộp bài; nếu quá hạn lưu thì vẫn chốt bài với đáp án trước hạn. */
  async submitAttemptWithAnswers(
    attemptId: string,
    learnerId: string,
    answers: Array<{ questionId: string; answers: string[] }> = [],
  ): Promise<ExamAttempt> {
    try {
      await attempts_ops.saveAnswers(this.runtime.context, attemptId, answers, learnerId);
    } catch (error) {
      if (
        !(error instanceof BadRequestException) ||
        error.message !== "Đã hết thời gian lưu câu trả lời."
      ) {
        throw error;
      }
    }
    return this.submitAttempt(attemptId, learnerId);
  }

  /** Chốt lượt thi nguyên tử, tự chấm câu khách quan và phát receipt chống nhầm lẫn. */
  async submitAttempt(
    attemptId: string,
    learnerId: string,
    trigger: "LEARNER" | "SYSTEM" = "LEARNER",
  ): Promise<ExamAttempt> {
    return await attempts_ops.submitAttempt(this.runtime.context, attemptId, learnerId, trigger);
  }

  /** Tìm lượt IN_PROGRESS quá hạn theo lô và nộp tự động bằng cùng logic submit. */
  async reconcileExpiredAttempts(limit = 100): Promise<number> {
    return await attempts_ops.reconcileExpiredAttempts(this.runtime.context, limit);
  }

  /** Đọc một lượt thi và ánh xạ đáp án từ Prisma hoặc kho nhớ. */
  async getAttempt(attemptId: string): Promise<ExamAttempt> {
    return await attempts_ops.getAttempt(this.runtime.context, attemptId);
  }

  /** Liệt kê kết quả đã nộp/chấm của học viên cùng trạng thái phúc khảo. */
  async listLearnerResults(learnerId: string): Promise<LearnerResult[]> {
    return await attempts_ops.listLearnerResults(this.runtime.context, learnerId);
  }

  /** Trả đúng kết quả thuộc học viên, từ chối truy cập chéo lượt thi. */
  async getLearnerResult(attemptId: string, learnerId: string): Promise<LearnerResult> {
    return await attempts_ops.getLearnerResult(this.runtime.context, attemptId, learnerId);
  }

  /** Mở yêu cầu phúc khảo duy nhất cho lượt đã chấm và thông báo giảng viên. */
  async requestRegrade(
    attemptId: string,
    reason: string,
    learnerId: string,
  ): Promise<RegradeRequest> {
    return await regrades_ops.requestRegrade(this.runtime.context, attemptId, reason, learnerId);
  }

  /** Liệt kê hàng đợi phúc khảo trong đúng phạm vi lớp của giảng viên. */
  async listRegradeRequests(
    actorId: string,
    status?: RegradeRequest["status"],
  ): Promise<RegradeRequest[]> {
    return await regrades_ops.listRegradeRequests(this.runtime.context, actorId, status);
  }

  /** Nhả yêu cầu phúc khảo mình đang xử lý về hàng đợi. */
  async releaseRegrade(requestId: string, actorId: string): Promise<RegradeRequest> {
    return await regrades_ops.releaseRegrade(this.runtime.context, requestId, actorId);
  }

  /** Nhận xử lý một yêu cầu OPEN bằng cập nhật có điều kiện để chống hai người cùng nhận. */
  async claimRegrade(requestId: string, actorId: string): Promise<RegradeRequest> {
    return await regrades_ops.claimRegrade(this.runtime.context, requestId, actorId);
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
    return await regrades_ops.resolveRegrade(this.runtime.context, requestId, input, actorId);
  }

  /** Liệt kê lượt thi trong phạm vi lớp giảng viên phụ trách. */
  async listAttempts(examId: string | undefined, actorId: string): Promise<ExamAttempt[]> {
    return await regrades_ops.listAttempts(this.runtime.context, examId, actorId);
  }

  /** Thu thập tối đa sáu tệp đã công khai trong các lớp cùng môn mà giảng viên được phân công. */
  async getExamGenerationContext(
    classId: string,
    actorId: string,
    rawMaterialIds: string[] = [],
    skipMaterials = false,
  ): Promise<ExamGenerationContext> {
    return await exam_generation_ops.getExamGenerationContext(
      this.runtime.context,
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
    return await exam_generation_ops.getGeneratedExamByRequest(
      this.runtime.context,
      clientRequestId,
      classId,
      actorId,
    );
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
    return await exam_generation_ops.createGeneratedExam(
      this.runtime.context,
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
    return await grading_ops.getAttemptReview(this.runtime.context, attemptId, actorId);
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
    return await grading_ops.gradeAttempt(
      this.runtime.context,
      attemptId,
      score,
      feedback,
      correctionReason,
      graderId,
      questionScores,
    );
  }

  /** Phân tích phân bố điểm, tỷ lệ hoàn thành và hiệu suất câu hỏi trong phạm vi giảng viên. */
  async getExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId: string,
  ): Promise<ExamAnalytics> {
    return await analytics_ops.getExamAnalytics(this.runtime.context, input, actorId);
  }

  /** Chuyển dữ liệu phân tích đề thi sang CSV có BOM để Excel đọc Unicode đúng. */
  async exportExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId: string,
  ): Promise<Buffer> {
    return await analytics_ops.exportExamAnalytics(this.runtime.context, input, actorId);
  }
}
