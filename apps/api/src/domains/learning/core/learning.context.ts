import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../../config/environment.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import {
  ObjectStorageService,
  type StoredObject,
} from "../../../infrastructure/object-storage.service.js";
import {
  SystemService,
  type ExamApprovalMode,
} from "../../system/core/system.service.js";
import {
  AttemptWithAnswers,
  ClassWithMembers,
  ContentReportWithActions,
  ExamWithQuestions,
  ForumPostWithRelations,
  MaterialAccessAction,
  MaterialSearchResult,
  MemoryAttendanceInterval,
  MemoryMaterialVersion,
  MemoryQuestionImage,
  SupportTicketWithAttachments,
  UploadedMaterialFile,
} from "./learning.shared.js";
import type {
  AttendanceAppeal,
  AttendanceRecord,
  AttendanceSessionReview,
  ClassClosureReadiness,
  ClassMemberHistory,
  ContentReport,
  CourseVersionSnapshot,
  ExamAnalytics,
  ExamApprovalRecord,
  ExamAttempt,
  FileReviewRecord,
  ForumPost,
  ForumTopic,
  GradeHistoryRecord,
  InstructorRole,
  LearnerExamSummary,
  LearnerProgress,
  LearnerResult,
  LearningClass,
  LearningCourse,
  LearningExam,
  LearningMaterial,
  LearningNotification,
  LearningQuestion,
  LiveSession,
  MaterialVersionSnapshot,
  ModerationActionRecord,
  OperationalReport,
  ProgressIntervention,
  ProviderAttendanceInput,
  RegradeRequest,
  ReportExport,
  ReportRun,
  RiskThresholds,
  SupportTicket,
  TicketComment,
} from "./learning.types.js";

/** Hợp đồng nội bộ của các nhóm nghiệp vụ; trạng thái vẫn thuộc một phiên bản service duy nhất. */
export interface LearningServiceContext {
  courses: LearningCourse[];
  courseVersions: CourseVersionSnapshot[];
  classes: LearningClass[];
  materials: LearningMaterial[];
  materialVersions: MemoryMaterialVersion[];
  questions: LearningQuestion[];
  questionImages: Map<string, MemoryQuestionImage>;
  exams: LearningExam[];
  attempts: ExamAttempt[];
  gradeHistory: GradeHistoryRecord[];
  examApprovals: ExamApprovalRecord[];
  regradeRequests: RegradeRequest[];
  topics: ForumTopic[];
  posts: ForumPost[];
  notifications: LearningNotification[];
  reports: ContentReport[];
  moderationActions: ModerationActionRecord[];
  sessions: LiveSession[];
  attendance: AttendanceRecord[];
  attendanceIntervals: MemoryAttendanceInterval[];
  attendanceAppeals: AttendanceAppeal[];
  tickets: SupportTicket[];
  ticketComments: TicketComment[];
  supportAttachmentFiles: Map<string, string>;
  materialFiles: Map<string, { objectKey: string; checksum: string }>;
  materialAccessLogs: Array<{
    materialId: string;
    userId: string;
    action: MaterialAccessAction;
    createdAt: string;
  }>;
  materialReviews: FileReviewRecord[];
  progressInterventions: ProgressIntervention[];
  reportRuns: ReportRun[];
  reportExports: Array<
    ReportExport & { filePath?: string; requestedById: string }
  >;
  instructorRoles: Map<string, InstructorRole>;
  classMemberHistory: ClassMemberHistory[];
  prisma: PrismaService | undefined;
  config: ConfigService<Environment, true> | undefined;
  objectStorage: ObjectStorageService | undefined;
  antivirus: AntivirusService | undefined;
  system: SystemService | undefined;
  enrollLearner(
    classId: string,
    learnerId: string,
    actorId?: string,
  ): Promise<LearningClass>;
  getClassClosureReadiness(classId: string): Promise<ClassClosureReadiness>;
  databaseClassClosureReadiness(
    database: Prisma.TransactionClient,
    classId: string,
  ): Promise<ClassClosureReadiness>;
  searchAccessibleMaterials(
    input: {
      query?: string;
      materialId?: string;
      classId?: string;
      courseId?: string;
      scope?: string;
      visibility?: string;
      aiOnly?: boolean;
      folder?: string;
      mimeType?: string;
      tag?: string;
      page?: number;
      pageSize?: number;
    },
    learnerId?: string,
    role?: string,
  ): Promise<MaterialSearchResult>;
  resolveMaterialDownload(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action?: MaterialAccessAction,
    context?: { ipAddress?: string; userAgent?: string },
    actorId?: string,
  ): Promise<{
    fileName: string;
    mimeType: string;
    objectKey: string;
    checksum?: string;
  }>;
  resolveMaterialVersionDownload(
    materialId: string,
    version: number,
    expires: number,
    signature: string,
    role: string,
    action?: MaterialAccessAction,
    actorId?: string,
  ): Promise<{
    fileName: string;
    mimeType: string;
    objectKey: string;
    checksum?: string;
  }>;
  createQuestion(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId?: string,
  ): Promise<LearningQuestion>;
  submitAttempt(attemptId: string, learnerId?: string): Promise<ExamAttempt>;
  listLearnerResults(learnerId?: string): Promise<LearnerResult[]>;
  gradeAttempt(
    attemptId: string,
    score: number,
    feedback: string,
    correctionReason?: string,
    graderId?: string,
    questionScores?: Array<{ questionId: string; score: number }>,
  ): Promise<ExamAttempt>;
  listNotifications(recipientId?: string): Promise<LearningNotification[]>;
  markNotificationRead(
    notificationId: string,
    recipientId?: string,
  ): Promise<LearningNotification>;
  getAttendanceReview(sessionId: string): Promise<AttendanceSessionReview>;
  isRecordingAvailable(
    session: Pick<
      LiveSession,
      "recordingUrl" | "recordingStatus" | "recordingExpiresAt"
    >,
  ): boolean;
  getOperationalReport(
    fromInput?: string,
    toInput?: string,
  ): Promise<OperationalReport>;
  database(): PrismaService | undefined;
  getExamApprovalMode(): Promise<ExamApprovalMode>;
  getQuestionApprovalMode(): Promise<ExamApprovalMode>;
  mapCourse(
    row: Prisma.CourseGetPayload<Record<string, never>>,
  ): LearningCourse;
  mapClass(row: ClassWithMembers): LearningClass;
  mapMaterial(
    row: Prisma.MaterialGetPayload<Record<string, never>>,
  ): LearningMaterial;
  mapQuestion(
    row: Prisma.QuestionGetPayload<Record<string, never>>,
  ): LearningQuestion;
  getExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId?: string,
  ): Promise<ExamAnalytics>;
  mapMaterialVersion(
    row: Prisma.MaterialVersionGetPayload<Record<string, never>>,
  ): MaterialVersionSnapshot;
  cloneQuestion(item: LearningQuestion): LearningQuestion;
  latestQuestionVersions(items: LearningQuestion[]): LearningQuestion[];
  sameGeneratedQuestion(
    existing: {
      content: string;
      type: string;
      difficulty: number;
      options: unknown;
      correctAnswers: unknown;
    },
    generated: {
      content: string;
      type: string;
      difficulty: number;
      options: string[];
      correctAnswers: string[];
    },
  ): boolean;
  questionContentHash(content: string): string;
  validateQuestionInput(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
  ): Omit<
    LearningQuestion,
    "id" | "status" | "version" | "familyId" | "supersedesId"
  >;
  validateSubmittedAnswers(
    question: LearningQuestion,
    answers: string[],
  ): string[];
  isQuestionAnswerCorrect(
    question: LearningQuestion,
    submitted: string[],
  ): boolean;
  mapExam(row: ExamWithQuestions): LearningExam;
  mapAttempt(row: AttemptWithAnswers): ExamAttempt;
  submissionReceipt(attemptId: string, submittedAt: string): string;
  mapRegradeRequest(
    row: Prisma.RegradeRequestGetPayload<Record<string, never>>,
  ): RegradeRequest;
  mapTopic(row: Prisma.ForumTopicGetPayload<Record<string, never>>): ForumTopic;
  mapPost(
    row:
      | Prisma.ForumPostGetPayload<Record<string, never>>
      | ForumPostWithRelations,
  ): ForumPost;
  mapReport(
    row:
      | Prisma.ContentReportGetPayload<Record<string, never>>
      | ContentReportWithActions,
  ): ContentReport;
  mapProgressIntervention(
    row: Prisma.ProgressInterventionGetPayload<Record<string, never>>,
  ): ProgressIntervention;
  progressInterventionHistory(
    value: Prisma.JsonValue,
  ): ProgressIntervention["history"];
  mapReportExport(
    row: Prisma.ReportExportGetPayload<Record<string, never>>,
  ): ReportExport;
  reportingPeriod(
    fromInput?: string,
    toInput?: string,
  ): { from: Date; to: Date };
  validateRiskThresholds(thresholds: RiskThresholds): void;
  validateTimezone(timezone: string): void;
  percentage(numerator: number, denominator: number): number;
  latestDate(values: Date[]): string | undefined;
  buildLearnerProgress(
    input: Omit<LearnerProgress, "riskLevel" | "riskReasons"> & {
      thresholds: RiskThresholds;
    },
  ): LearnerProgress;
  operationalReportCsv(report: OperationalReport): string;
  recordMemoryModeration(
    report: ContentReport,
    actorId: string,
    action: ModerationActionRecord["action"],
    reason: string,
    nextStatus: ContentReport["status"],
  ): void;
  recordMemberHistory(
    classId: string,
    memberId: string,
    memberType: ClassMemberHistory["memberType"],
    action: string,
    actorId: string,
    detail: { role?: InstructorRole; source?: string; reason?: string },
  ): void;
  buildProviderUrls(
    provider: LiveSession["provider"],
    token: string,
  ): { hostUrl: string; attendeeUrl: string };
  seededOrder(values: string[], seed: string): string[];
  resolveExamScoreAllocations(
    questionIds: string[],
    totalScore: number,
    allocations?: Array<{ questionId: string; score: number }>,
  ): Record<string, number>;
  examQuestionScore(exam: LearningExam, questionId: string): number;
  provisionProviderMeeting(requested: LiveSession["provider"]): Promise<{
    provider: LiveSession["provider"];
    hostUrl: string;
    attendeeUrl: string;
    fallbackUsed: boolean;
    attempts: number;
  }>;
  userIdsForRole(
    database: PrismaService | Prisma.TransactionClient,
    roleCode: string,
  ): Promise<string[]>;
  notifyClassMembers(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
    type: string,
    title: string,
    entityId: string,
    templateEventCode?: string,
    templateVariables?: Record<string, string>,
  ): Promise<void>;
  mapSession(
    row: Prisma.LiveSessionGetPayload<Record<string, never>>,
  ): LiveSession;
  mapAttendance(
    row: Prisma.AttendanceRecordGetPayload<Record<string, never>>,
  ): AttendanceRecord;
  mapAttendanceAppeal(
    row: Prisma.AttendanceAppealGetPayload<Record<string, never>>,
  ): AttendanceAppeal;
  mapTicket(
    row:
      | Prisma.SupportTicketGetPayload<Record<string, never>>
      | SupportTicketWithAttachments,
  ): SupportTicket;
  isLiveProvider(value: string): value is LiveSession["provider"];
  validateProviderAttendanceInput(records: ProviderAttendanceInput[]): void;
  calculateProviderAttendanceMinutes(
    joinedAt: Date,
    leftAt: Date,
    startsAt: Date,
    endsAt: Date,
  ): number;
  mergedAttendanceMinutes(
    intervals: Array<{ joinedAt: Date; leftAt: Date }>,
    startsAt: Date,
    endsAt: Date,
  ): number;
  deriveProviderAttendanceStatus(
    joinedAt: Date,
    attendedMinutes: number,
    startsAt: Date,
  ): AttendanceRecord["status"];
  validateAttendanceMinutes(
    attendedMinutes: number,
    startsAt: Date,
    endsAt: Date,
  ): void;
  buildClassClosureReadiness(
    status: LearningClass["status"],
    endAt: Date,
    counts: Omit<ClassClosureReadiness, "eligible" | "blockers">,
  ): ClassClosureReadiness;
  fileReviewAction(value: string): FileReviewRecord["action"];
  getDatabaseClass(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
  ): Promise<LearningClass>;
  getDatabaseExam(
    database: PrismaService | Prisma.TransactionClient,
    examId: string,
  ): Promise<LearningExam>;
  getDatabaseAttempt(
    database: PrismaService | Prisma.TransactionClient,
    attemptId: string,
  ): Promise<ExamAttempt>;
  requireUserRole(
    database: PrismaService,
    userId: string,
    roleCode: "INSTRUCTOR" | "LEARNER",
    message: string,
  ): Promise<void>;
  getStoragePolicy(database: PrismaService): Promise<{
    maxFileSizeMb: number;
    storageQuotaMb: number;
    allowedMimeTypes: string[];
  }>;
  storeUpload(
    classId: string,
    materialId: string,
    upload: UploadedMaterialFile,
    quarantined?: boolean,
  ): Promise<{ objectKey: string; checksum: string }>;
  writeStoredFile(objectKey: string, buffer: Buffer): Promise<StoredObject>;
  removeStoredFile(objectKey: string): Promise<void>;
  removeQuestionObjectIfUnreferenced(objectKey: string): Promise<void>;
  resolveObjectPath(objectKey: string): string;
  signMaterialAccess(
    materialId: string,
    expires: number,
    action: MaterialAccessAction,
  ): string;
  signRecordingAccess(
    sessionId: string,
    expires: number,
    learnerId: string,
  ): string;
  verifyExpiringSignature(
    expectedSignature: string,
    expires: number,
    signature: string,
    message: string,
  ): void;
  verifyMaterialAccess(
    materialId: string,
    expires: number,
    signature: string,
    action: MaterialAccessAction,
  ): void;
  userIdForRole(role: string): string;
  readStoredFile(objectKey: string): Promise<Buffer>;
  isMaterialObjectKey(objectKey: string): boolean;
  canManageSupport(role: string): boolean;
  canAccessMemoryMaterial(
    material: LearningMaterial,
    role: string,
    actorId: string,
  ): boolean;
  examAvailability(
    exam: LearningExam,
    attemptCount: number,
    active: boolean,
    timestamp: Date,
  ): LearnerExamSummary["availabilityStatus"];
  attemptDeadline(
    startedAt: Date,
    durationMinutes: number,
    examCloseAt: Date,
  ): Date;
  isMemoryAnswerCorrect(questionId: string, submitted: string[]): boolean;
  validateForumContent(value: string, label: string): string;
  validateSupportText(value: string, label: string): string;
  validateSupportUpload(upload: UploadedMaterialFile): void;
  detectMaliciousUpload(upload: UploadedMaterialFile): string | undefined;
  validateQuestionImage(upload: UploadedMaterialFile): Promise<void>;
  scanUpload(upload: UploadedMaterialFile): Promise<string | undefined>;
  enforceForumPolicy(
    database: PrismaService,
    authorId: string,
    content: string,
  ): Promise<"FLAG" | "HIDE_PENDING_REVIEW" | undefined>;
  enforceMemoryForumPolicy(
    authorId: string,
    content: string,
  ): Promise<"FLAG" | "HIDE_PENDING_REVIEW" | undefined>;
  moderationTerms(): string[];
  assertForumClassAccess(
    classItem: ClassWithMembers,
    role: string,
    actorId: string,
  ): void;
  assertMemoryForumClassAccess(
    classId: string,
    role: string,
    actorId: string,
  ): void;
  toStringArray(value: Prisma.JsonValue): string[];
  findCourse(courseId: string): LearningCourse;
  findClass(classId: string): LearningClass;
  findExam(examId: string): LearningExam;
  findAttempt(attemptId: string): ExamAttempt;
  findTopic(topicId: string): ForumTopic;
  findPost(postId: string): ForumPost;
  findReport(reportId: string): ContentReport;
  findSession(sessionId: string): LiveSession;
}
