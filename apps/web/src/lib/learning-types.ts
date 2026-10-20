/** Các view model đào tạo mà trang web nhận từ API, tách khỏi cấu trúc lưu trữ nội bộ. */
export type PublishStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface Course {
  id: string;
  code: string;
  name: string;
  description: string;
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
  startAt: string;
  endAt: string;
  capacity: number;
  timezone: string;
  allowLateEnrollment: boolean;
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
  unlockedAttendanceSessions: number;
  openAppeals: number;
}
export type InstructorRole = "PRIMARY" | "CO_INSTRUCTOR";
export interface ClassInstructorAssignment {
  instructorId: string;
  role: InstructorRole;
  assignedAt: string;
}
export interface ClassMemberHistory {
  id: string;
  memberId: string;
  memberType: "INSTRUCTOR" | "LEARNER";
  action: string;
  role?: InstructorRole;
  source?: string;
  reason?: string;
  actorId: string;
  createdAt: string;
}
export interface ClassRoster {
  classId: string;
  instructors: Array<
    ClassInstructorAssignment & { displayName?: string; email?: string }
  >;
  enrollments: Array<{
    learnerId: string;
    displayName?: string;
    email?: string;
    status: "ACTIVE" | "CANCELLED";
    source: string;
    joinedAt: string;
    removalReason?: string;
    removedAt?: string;
  }>;
  history: ClassMemberHistory[];
}
export interface EnrollmentImportResult {
  userId: string;
  status: "ENROLLED" | "SKIPPED" | "FAILED";
  message: string;
}
export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
  roleCode: "INSTRUCTOR" | "LEARNER";
}
export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  maxPoints: number;
}
export interface AssignmentAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  canPreview: boolean;
}
export interface AssignmentGradeChange {
  id: string;
  action: "GRADED" | "CORRECTED";
  submissionRevision: number;
  actorId: string;
  previousScore?: number;
  nextScore: number;
  reason?: string;
  createdAt: string;
}
export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  content: string;
  attachments: AssignmentAttachment[];
  status: "SUBMITTED" | "GRADED";
  revision: number;
  submittedAt: string;
  score?: number;
  rubricScores: Array<{ criterionId: string; score: number }>;
  feedback?: string;
  gradedAt?: string;
  gradeHistory?: AssignmentGradeChange[];
}
export interface AssignmentChange {
  id: string;
  action: "DRAFT_UPDATED" | "PUBLISHED" | "DUE_DATE_EXTENDED" | "CLOSED";
  actorId: string;
  reason?: string;
  fromVersion: number;
  toVersion: number;
  createdAt: string;
}
export interface Assignment {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  description: string;
  instructions: string;
  dueAt: string;
  maxScore: number;
  rubric: RubricCriterion[];
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  version: number;
  closedAt?: string;
  closeReason?: string;
  createdById: string;
  submission?: AssignmentSubmission;
  changes?: AssignmentChange[];
  createdAt: string;
}
export interface AcademicCalendarEvent {
  id: string;
  classId: string;
  classCode: string;
  type: "CLASS" | "LIVE_SESSION" | "EXAM" | "ASSIGNMENT";
  title: string;
  startAt: string;
  endAt?: string;
  href: string;
}
export interface ClassAnnouncement {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  body: string;
  authorName: string;
  publishedAt: string;
}
export interface GradebookRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  examEarned: number;
  examPossible: number;
  assignmentEarned: number;
  assignmentPossible: number;
  totalPercent: number;
  awaitingGrade: number;
  notSubmitted: number;
}
export interface GradingQueueGroup {
  id: string;
  type: "ASSIGNMENT" | "EXAM";
  classId: string;
  classCode: string;
  title: string;
  maxScore: number;
  submittedCount: number;
  pendingCount: number;
  items: Array<{
    id: string;
    learnerId: string;
    learnerName: string;
    learnerEmail: string;
    status: "SUBMITTED" | "GRADED";
    submittedAt: string;
    revision?: number;
  }>;
}

export interface Material {
  id: string;
  /** Rỗng khi là học liệu dùng chung theo môn, không thuộc lớp nào. */
  classId: string | null;
  courseId?: string;
  ownerId: string;
  editorIds?: string[];
  name: string;
  mimeType: string;
  sizeBytes: number;
  folder: string;
  tags: string[];
  version: number;
  visibility: "DRAFT" | "PUBLISHED" | "HIDDEN";
  scope: "SHARED" | "CLASS";
  quarantinedAt?: string;
  quarantineReason?: string;
  createdAt: string;
}

/** HIDE và REQUEST_CHANGES chỉ còn trong lịch sử kiểm duyệt cũ. */
export interface MaterialReview {
  id: string;
  materialId: string;
  reviewerId: string;
  action: "APPROVE" | "REVOKE" | "HIDE" | "REQUEST_CHANGES";
  reason?: string;
  createdAt: string;
}

export interface Question {
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
}
export interface MaterialVersionSnapshot {
  id: string;
  materialId: string;
  version: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folder: string;
  tags: string[];
  visibility: "DRAFT" | "PUBLISHED" | "HIDDEN";
  createdBy: string;
  createdAt: string;
}
export interface QuestionImportResult {
  row: number;
  status: "IMPORTED" | "FAILED";
  questionId?: string;
  message: string;
}

export interface Exam {
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

export interface LearnerExamSummary extends Exam {
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
export interface AiProviderSummary {
  id: string;
  provider: string;
  name: string;
  model: string;
  isDefault: boolean;
  healthStatus: string;
}
export interface AiGeneratedExamResult {
  exam: Exam;
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
  learner: { id: string; name?: string; email?: string };
  questions: Array<{
    questionId: string;
    type: Question["type"];
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
    awardedScore: number;
    maxScore: number;
  }>;
  regradeRequest?: RegradeRequest;
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
export interface ModerationActionRecord {
  id: string;
  reportId: string;
  actorId: string;
  action:
    | "CLAIM"
    | "HIDE_CONTENT"
    | "KEEP_CONTENT"
    | "ESCALATE_ADMIN"
    | "APPEAL";
  reason: string;
  previousStatus: ContentReport["status"];
  nextStatus: ContentReport["status"];
  createdAt: string;
}
export interface ContentReport {
  id: string;
  targetType: "TOPIC" | "POST";
  targetId: string;
  reporterId: string;
  reason: string;
  details: string;
  status: "OPEN" | "IN_REVIEW" | "ESCALATED" | "RESOLVED" | "REJECTED";
  resolution?: string;
  assignedToId?: string;
  escalationLevel: number;
  resolvedAt?: string;
  appealReason?: string;
  appealedAt?: string;
  createdAt: string;
  updatedAt: string;
  actions: ModerationActionRecord[];
}
export interface ModerationContext {
  report: ContentReport;
  classId: string;
  topicTitle: string;
  targetAuthorId: string;
  targetBody: string;
  surroundingPosts: Array<
    Pick<ForumPost, "id" | "authorId" | "body" | "createdAt">
  >;
}
export interface RiskThresholds {
  attendanceBelow: number;
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
  attendanceRate: number;
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
export interface ReportRun {
  id: string;
  reportType: "OPERATIONS";
  definitionVersion: string;
  timezone: string;
  filters: { from: string; to: string };
  result: OperationalReport;
  requestedById: string;
  createdAt: string;
}
export interface ReportExport {
  id: string;
  reportRunId: string;
  format: "CSV";
  status: "QUEUED" | "COMPLETED" | "FAILED" | "EXPIRED";
  fileName: string;
  sizeBytes?: number;
  errorMessage?: string;
  expiresAt: string;
  createdAt: string;
}
export interface LiveSession {
  id: string;
  classId: string;
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
  attendanceLockedAt?: string;
  attendanceLockedById?: string;
  requestedProvider?: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  fallbackUsed?: boolean;
  provisioningAttempts?: number;
  recordingStatus?: "NONE" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
  recordingReadyAt?: string;
  recordingExpiresAt?: string;
  recordingError?: string;
}
export interface AttendanceRecord {
  sessionId: string;
  learnerId: string;
  joinedAt?: string;
  leftAt?: string;
  attendedMinutes: number;
  status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
  adjustmentReason?: string;
  providerParticipantId?: string;
}
export interface AttendanceAppeal {
  id: string;
  sessionId: string;
  learnerId: string;
  reason: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED";
  resolution?: string;
  createdAt: string;
}
export interface AttendanceSessionReview {
  session: LiveSession;
  enrolledLearnerIds: string[];
  records: AttendanceRecord[];
  appeals: AttendanceAppeal[];
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
export interface Ticket {
  id: string;
  reporterId: string;
  category: string;
  severity: "P0" | "P1" | "P2" | "P3";
  description: string;
  contextId?: string;
  duplicateOfId?: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  assigneeId?: string;
  resolution?: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  attachments: SupportAttachment[];
}
export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: string;
}
export interface ChatDirectoryEntry {
  id: string;
  displayName: string;
  roleCode: "SYSTEM_ADMIN" | "CENTER_MANAGER" | "INSTRUCTOR" | "LEARNER";
  sharedClasses: Array<{ id: string; code: string; name: string }>;
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  clientMessageId: string;
  content: string;
  replyTo?: { id: string; senderName: string; content: string };
  attachments: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    canPreview: boolean;
  }>;
  mentionedUserIds: string[];
  context?: {
    type: "ASSIGNMENT" | "EXAM" | "MATERIAL";
    id: string;
    title: string;
    href: string;
  };
  createdAt: string;
}
export interface ChatConversation {
  id: string;
  type: "DIRECT" | "CLASS";
  classId?: string;
  title: string;
  members: Array<{
    userId: string;
    displayName: string;
    roleCode: string;
    status: "ACTIVE" | "REMOVED";
  }>;
  lastMessage?: ChatMessage;
  unreadCount: number;
  readOnly: boolean;
  mutedUntil?: string;
  updatedAt: string;
}
export interface ChatMessagePage {
  items: ChatMessage[];
  nextCursor?: string;
}
