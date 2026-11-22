/** Các view model của miền đào tạo, tách hợp đồng API khỏi cấu trúc bản ghi Prisma nội bộ. */
type PublishStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface LearningCourse {
  id: string;
  code: string;
  name: string;
  description: string;
  grade?: number;
  subject?: string;
  outcomes: string[];
  status: PublishStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface CourseVersionSnapshot {
  id: string;
  courseId: string;
  version: number;
  name: string;
  description: string;
  grade?: number;
  subject?: string;
  outcomes: string[];
  publishedBy: string;
  publishedAt: string;
}

export interface LearningClass {
  id: string;
  courseId: string;
  courseVersion: number;
  code: string;
  name: string;
  term: string;
  grade?: number;
  subject?: string;
  startAt: string;
  endAt: string;
  capacity: number;
  timezone: string;
  allowLateEnrollment: boolean;
  allowPeerGradeViewing?: boolean;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  instructorIds: string[];
  learnerIds: string[];
  closeReason?: string;
  archivePolicy?: string;
  closedAt?: string;
  archivedAt?: string;
}

export interface ClassCapabilities {
  classId: string;
  relationship: "ADMIN" | "MANAGER" | "INSTRUCTOR" | "LEARNER" | "NONE";
  classStatus: LearningClass["status"];
  actions: Record<"view" | "manageRoster" | "manageContent" | "submitWork" | "grade" | "postForum" | "joinLive" | "chat", { allowed: boolean; reason?: string }>;
}
export interface ClassClosureReadiness {
  eligible: boolean;
  blockers: string[];
  openExams: number;
  inProgressAttempts: number;
  pendingGrades: number;
  openAssignments: number;
  pendingAssignmentGrades: number;
  openRegrades: number;
  activeSessions: number;
}
export type InstructorRole = "PRIMARY" | "CO_INSTRUCTOR";
interface ClassInstructorAssignment {
  instructorId: string;
  role: InstructorRole;
  assignedAt: string;
}
export interface ClassRoster {
  classId: string;
  instructors: Array<
    ClassInstructorAssignment & { displayName?: string; email?: string | null }
  >;
  enrollments: Array<{
    learnerId: string;
    displayName?: string;
    email?: string | null;
    status: "ACTIVE" | "CANCELLED";
    source: string;
    joinedAt: string;
    removalReason?: string;
    removedAt?: string;
  }>;
}
export interface EnrollmentImportResult {
  userId: string;
  status: "ENROLLED" | "SKIPPED" | "FAILED";
  message: string;
}
export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string | null;
  roleCode: "INSTRUCTOR" | "LEARNER";
}

export interface LearningMaterial {
  id: string;
  classId: string;
  courseId?: string;
  ownerId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folder: string;
  tags: string[];
  version: number;
  visibility: "DRAFT" | "PUBLISHED" | "HIDDEN";
  scope: MaterialScope;
  quarantinedAt?: string;
  quarantineReason?: string;
  createdAt: string;
}
/** CLASS: học liệu gắn chặt vào một lớp học cụ thể. */
type MaterialScope = "CLASS";

export interface LearningQuestion {
  id: string;
  courseId: string;
  type:
    | "SINGLE_CHOICE"
    | "MULTIPLE_CHOICE"
    | "TRUE_FALSE"
    | "SHORT_ANSWER"
    | "ESSAY";
  content: string;
  options: string[];
  correctAnswers: string[];
  difficulty: 1 | 2 | 3;
  tags: string[];
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED";
  version: number;
  familyId?: string;
  supersedesId?: string;
  imageUrl?: string;
  imageName?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  /** Chỉ có ở bản xem đề của giảng viên: lỗi cần sửa trước khi gửi duyệt. */
  issues?: string[];
  /** Chỉ có ở bộ câu hỏi của lượt đang làm: điểm tối đa của câu trong đề. */
  points?: number;
}
export interface QuestionImportResult {
  row: number;
  status: "IMPORTED" | "FAILED";
  questionId?: string;
  message: string;
}

export interface LearningExam {
  hidden?: boolean;
  id: string;
  classId: string;
  title: string;
  questionIds: string[];
  durationMinutes: number;
  totalScore: number;
  openAt: string;
  closeAt: string;
  attemptLimit: number;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "CLOSED";
  version: number;
  shuffleQuestions?: boolean;
  randomSeed?: string;
  questionScores?: Record<string, number>;
  aiContext?: {
    mode: "COURSE_MATERIALS" | "WEB_SEARCH";
    materialIds: string[];
    sources: Array<{ title: string; url: string }>;
    providerId?: string;
    provider?: string;
    model?: string;
    warnings?: string[];
  };
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
  serverTime: string;
}

export interface ExamAttempt {
  attemptNo?: number;
  id: string;
  examId: string;
  learnerId: string;
  answers: Record<string, string[]>;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  startedAt: string;
  submittedAt?: string;
  score?: number;
  feedback?: string;
  gradePublishedAt?: string;
  serverTime?: string;
  lastSavedAt?: string;
  submissionReceipt?: string;
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
  exam: { id: string; classId: string; title: string; totalScore: number };
  learner: { id: string; name?: string; email?: string | null };
  questions: Array<{
    questionId: string;
    type: LearningQuestion["type"];
    content: string;
    imageUrl?: string;
    submittedAnswers: string[];
    awardedScore: number;
    maxScore: number;
    requiresManualGrade: boolean;
  }>;
}

export interface RegradeRequest {
  id: string;
  attemptId: string;
  learnerId: string;
  reason: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED";
  resolution?: string;
  assignedToId?: string;
  resolvedById?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface LearnerResult {
  attempt: ExamAttempt;
  exam: { id: string; title: string; totalScore: number; closeAt: string };
  answerBreakdown: Array<{
    questionId: string;
    content: string;
    submittedAnswers: string[];
    /** Ẩn khi đề còn mở để kết quả từng câu không trở thành công cụ dò đáp án cho lượt sau/học viên khác. */
    awardedScore?: number;
    maxScore: number;
  }>;
  /** Có giá trị khi điểm từng câu đang ẩn: thời điểm đề đóng và chi tiết được công bố. */
  breakdownVisibleAt?: string;
  regradeRequest?: RegradeRequest;
}

export interface ForumTopic {
  id: string;
  classId: string;
  title: string;
  body: string;
  authorId: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  status: "VISIBLE" | "HIDDEN";
  createdAt: string;
}

export interface ForumPost {
  id: string;
  topicId: string;
  authorId: string;
  body: string;
  parentId?: string;
  status: "VISIBLE" | "HIDDEN";
  attachmentIds: string[];
  mentionedUserIds: string[];
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  editCount?: number;
}
export interface ExamAnalytics {
  generatedAt: string;
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

export interface LearningNotification {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  entityType: string;
  entityId: string;
  readAt?: string;
  createdAt: string;
}

export interface RiskThresholds {
  scoreBelow: number;
  completionBelow: number;
}
export interface ProgressIntervention {
  id: string;
  classId: string;
  learnerId: string;
  ownerId: string;
  createdById: string;
  title: string;
  notes?: string;
  dueAt: string;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  outcome?: string;
  cancellationReason?: string;
  acceptedAt?: string;
  completedAt?: string;
  history: Array<{
    fromOwnerId: string;
    toOwnerId: string;
    reason: string;
    actorId: string;
    createdAt: string;
  }>;
  createdAt: string;
}
export interface LearnerProgress {
  learnerId: string;
  materialCompletionRate: number;
  assessmentCompletionRate: number;
  averageScore: number;
  lastActivityAt?: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskReasons: string[];
  interventions: ProgressIntervention[];
}
export interface ClassProgressReport {
  classId: string;
  classCode: string;
  from: string;
  to: string;
  thresholds: RiskThresholds;
  learners: LearnerProgress[];
  generatedAt: string;
}
export interface OperationalReport {
  courses: number;
  classes: number;
  activeClasses: number;
  learners: number;
  materials: number;
  publishedMaterials: number;
  questions: number;
  exams: number;
  liveSessions: number;
  openReports: number;
  openTickets: number;
  generatedAt: string;
  definitionVersion: string;
  timezone: string;
  metricDefinitions: Record<string, string>;
}

export interface LiveSession {
  id: string;
  classId: string;
  hostId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  provider: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED";
  hostUrl: string;
  attendeeUrl: string;
  recordingUrl?: string;
  timezone: string;
  changeReason?: string;
  cancellationReason?: string;
  recordingStatus?: "NONE" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
  recordingReadyAt?: string;
  recordingExpiresAt?: string;
  recordingError?: string;
  requestedProvider?: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  fallbackUsed?: boolean;
  provisioningAttempts?: number;
}


export interface SupportTicket {
  id: string;
  clientRequestId?: string;
  reporterId: string;
  category: string;
  severity: "P0" | "P1" | "P2" | "P3";
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  contextId?: string;
  duplicateOfId?: string;
  assigneeId?: string;
  resolution?: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  attachments: SupportAttachment[];
}
export interface SupportAttachment {
  id: string;
  ticketId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}
export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: string;
}
