import type { ByteSizeNumber, DecimalNumber, IsoDateTimeString } from "./primitives.js";

export type QuestionType =
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY";

export type QuestionStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED";

/** Hợp đồng câu hỏi ngân hàng dùng chung giữa API và Web. */
export interface LearningQuestion {
  id: string;
  courseId: string;
  type: QuestionType;
  content: string;
  options: string[];
  correctAnswers: string[];
  difficulty: 1 | 2 | 3;
  tags: string[];
  status: QuestionStatus;
  version: number;
  familyId?: string;
  supersedesId?: string;
  imageUrl?: string;
  imageName?: string;
  imageMimeType?: string;
  imageSizeBytes?: ByteSizeNumber;
  /** Chỉ có ở bản xem đề của giảng viên: lỗi cần sửa trước khi gửi duyệt. */
  issues?: string[];
  /** Chỉ có ở bộ câu hỏi của lượt đang làm: điểm tối đa của câu trong đề. */
  points?: DecimalNumber;
}

export interface QuestionImportResult {
  row: number;
  status: "IMPORTED" | "FAILED";
  questionId?: string;
  message: string;
}

export type ExamStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED";
export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "GRADED";
export type RegradeStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED";

export interface ExamAiContext {
  mode: "COURSE_MATERIALS" | "WEB_SEARCH";
  materialIds: string[];
  sources: Array<{ title: string; url: string }>;
  providerId?: string;
  provider?: string;
  model?: string;
  warnings?: string[];
}

/** Hợp đồng đề kiểm tra dùng chung; mọi trường điểm Decimal được chuẩn hóa thành number. */
export interface LearningExam {
  hidden?: boolean;
  aiTutorEnabled?: boolean;
  showAnswersAfterSubmit?: boolean;
  id: string;
  classId: string;
  title: string;
  questionIds: string[];
  durationMinutes: number;
  totalScore: DecimalNumber;
  openAt: IsoDateTimeString;
  closeAt: IsoDateTimeString;
  attemptLimit: number;
  status: ExamStatus;
  version: number;
  shuffleQuestions?: boolean;
  randomSeed?: string;
  questionScores?: Record<string, DecimalNumber>;
  aiContext?: ExamAiContext;
}

export type AiTutorPresetKey =
  | "CONCEPT_HINT"
  | "FIRST_STEP"
  | "KEY_CLUES"
  | "APPROACH_STRATEGY";

/** Câu hỏi gợi mở mẫu cho phép học viên bấm chọn nhanh và tái sử dụng bộ nhớ đệm theo câu hỏi. */
export interface AiTutorPresetPrompt {
  key: AiTutorPresetKey;
  label: string;
  prompt: string;
}

/** Một lượt hỏi đáp dẫn dắt đã hoàn tất giữa học viên và trợ lý AI trên một câu hỏi cụ thể. */
export interface ExamTutorTurn {
  id: string;
  questionId: string;
  presetKey?: AiTutorPresetKey | null;
  userPrompt: string;
  aiReply: string;
  fromCache: boolean;
  createdAt: IsoDateTimeString;
}

/** Trạng thái hạn mức hỏi đáp AI còn lại của lượt làm bài theo từng câu và trên toàn đề. */
export interface ExamTutorQuotaSnapshot {
  maxPerQuestion: number;
  maxPerExam: number;
  examUsed: number;
  examRemaining: number;
  questionUsedById: Record<string, number>;
}

/** Toàn bộ lịch sử hội thoại theo từng câu hỏi và cấu hình gợi ý mẫu của lượt thi đang mở. */
export interface ExamAttemptTutorState {
  enabled: boolean;
  presets: AiTutorPresetPrompt[];
  quota: ExamTutorQuotaSnapshot;
  threads: Record<string, ExamTutorTurn[]>;
}

/** Kết quả trả về ngay sau một lượt hỏi đáp dẫn dắt thành công. */
export interface ExamTutorAskResult {
  turn: ExamTutorTurn;
  quota: ExamTutorQuotaSnapshot;
}

export interface LearnerExamSummary extends LearningExam {
  questionCount: number;
  availabilityStatus:
    | "UPCOMING"
    | "AVAILABLE"
    | "IN_PROGRESS"
    | "ATTEMPT_LIMIT_REACHED"
    | "CLOSED";
  remainingAttempts: number;
  serverTime: IsoDateTimeString;
}

export interface ExamAttempt {
  attemptNo?: number;
  id: string;
  examId: string;
  learnerId: string;
  answers: Record<string, string[]>;
  status: AttemptStatus;
  startedAt: IsoDateTimeString;
  submittedAt?: IsoDateTimeString;
  score?: DecimalNumber;
  feedback?: string;
  gradePublishedAt?: IsoDateTimeString;
  serverTime?: IsoDateTimeString;
  lastSavedAt?: IsoDateTimeString;
  submissionReceipt?: string;
}

export interface AiProviderSummary {
  id: string;
  provider: string;
  name: string;
  model: string;
  isDefault: boolean;
  healthStatus: string;
}

export interface AiGeneratedExamResult {
  exam: LearningExam;
  generatedQuestionCount: number;
  providerId: string;
  provider: string;
  model: string;
  context: {
    mode: "COURSE_MATERIALS" | "WEB_SEARCH";
    materialIds: string[];
    materialNames: string[];
    sources: Array<{ title: string; url: string }>;
  };
  warnings: string[];
}

export interface ExamAttemptReview {
  attempt: ExamAttempt;
  exam: { id: string; classId: string; title: string; totalScore: DecimalNumber };
  learner: { id: string; name?: string; email?: string | null };
  questions: Array<{
    questionId: string;
    type: QuestionType;
    content: string;
    imageUrl?: string;
    submittedAnswers: string[];
    awardedScore: DecimalNumber;
    maxScore: DecimalNumber;
    requiresManualGrade: boolean;
  }>;
}

export interface RegradeRequest {
  id: string;
  attemptId: string;
  learnerId: string;
  reason: string;
  status: RegradeStatus;
  resolution?: string;
  assignedToId?: string;
  resolvedById?: string;
  resolvedAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
}

export interface LearnerResult {
  attempt: ExamAttempt;
  exam: {
    id: string;
    title: string;
    totalScore: DecimalNumber;
    closeAt: IsoDateTimeString;
    showAnswersAfterSubmit?: boolean;
  };
  answerBreakdown: Array<{
    questionId: string;
    content: string;
    submittedAnswers: string[];
    /** Ẩn khi đề còn mở (trừ khi giảng viên bật cho phép xem đáp án sau khi nộp) để không lộ đáp án cho học viên khác. */
    awardedScore?: DecimalNumber;
    maxScore: DecimalNumber;
    /** Chỉ trả về khi giảng viên bật tùy chọn cho phép học sinh xem đáp án sau khi nộp bài. */
    options?: string[];
    correctAnswers?: string[];
  }>;
  /** Có giá trị khi điểm từng câu đang ẩn: thời điểm đề đóng và chi tiết được công bố. */
  breakdownVisibleAt?: IsoDateTimeString;
  regradeRequest?: RegradeRequest;
}

export interface ExamAnalytics {
  generatedAt: IsoDateTimeString;
  filters: { classId?: string; examId?: string; from?: string; to?: string };
  metricDefinitions: Record<string, string>;
  exams: Array<{
    examId: string;
    classId: string;
    title: string;
    sampleSize: number;
    smallSampleWarning: boolean;
    averagePercentage: number;
    passRate: number;
    questionStatsAvailable: boolean;
    questionStats: Array<{
      questionId: string;
      difficulty: number;
      responseCount: number;
      correctRate: number;
    }>;
  }>;
}
