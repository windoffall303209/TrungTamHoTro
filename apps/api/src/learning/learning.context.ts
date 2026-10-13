import { ConfigService } from "@nestjs/config";
import { createReadStream } from "node:fs";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import type { Environment } from "../config/environment.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { AntivirusService } from "../infrastructure/antivirus.service.js";
import {
  ObjectStorageService,
  type StoredObject,
} from "../infrastructure/object-storage.service.js";
import type { ScannedQuestionDraft } from "../system/ai-provider.service.js";
import {
  SystemService,
  type ExamApprovalMode,
} from "../system/system.service.js";
import {
  AttemptWithAnswers,
  ClassWithMembers,
  ContentReportWithActions,
  ExamGenerationContext,
  ExamWithQuestions,
  ForumPostWithRelations,
  MaterialAccessAction,
  MaterialDownload,
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
  ClassCapabilities,
  ClassClosureReadiness,
  ClassMemberHistory,
  ClassProgressReport,
  ClassRoster,
  ContentReport,
  CourseVersionSnapshot,
  DirectoryUser,
  EnrollmentImportResult,
  ExamAnalytics,
  ExamApprovalRecord,
  ExamAttempt,
  ExamAttemptReview,
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
  ModerationContext,
  OperationalReport,
  ProgressIntervention,
  ProviderAttendanceInput,
  QuestionImportResult,
  RegradeRequest,
  ReportExport,
  ReportRun,
  RiskThresholds,
  SupportAttachment,
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
  listCourses(): Promise<LearningCourse[]>;
  createCourse(
    input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes">,
    actorId?: string,
  ): Promise<LearningCourse>;
  updateCourse(
    courseId: string,
    input: Pick<LearningCourse, "name" | "description" | "outcomes">,
    actorId?: string,
  ): Promise<LearningCourse>;
  listCourseVersions(courseId: string): Promise<CourseVersionSnapshot[]>;
  publishCourse(courseId: string, actorId?: string): Promise<LearningCourse>;
  archiveCourse(
    courseId: string,
    reason: string,
    actorId?: string,
  ): Promise<LearningCourse>;
  listClasses(role: string, actorId?: string): Promise<LearningClass[]>;
  getClassCapabilities(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<ClassCapabilities>;
  createClass(
    input: Pick<
      LearningClass,
      "courseId" | "code" | "name" | "term" | "startAt" | "endAt" | "capacity"
    > &
      Partial<Pick<LearningClass, "timezone" | "allowLateEnrollment">>,
    actorId?: string,
  ): Promise<LearningClass>;
  assignInstructor(
    classId: string,
    instructorId: string,
    requestedRole?: InstructorRole,
    actorId?: string,
  ): Promise<LearningClass>;
  transferPrimaryInstructor(
    classId: string,
    expectedPrimaryId: string,
    newPrimaryId: string,
    rawReason: string,
    actorId?: string,
  ): Promise<LearningClass>;
  removeInstructor(
    classId: string,
    instructorId: string,
    reason: string,
    actorId?: string,
  ): Promise<LearningClass>;
  enrollLearner(
    classId: string,
    learnerId: string,
    actorId?: string,
  ): Promise<LearningClass>;
  importEnrollments(
    classId: string,
    userIds: string[],
    actorId?: string,
  ): Promise<EnrollmentImportResult[]>;
  removeEnrollment(
    classId: string,
    learnerId: string,
    reason: string,
    actorId?: string,
  ): Promise<LearningClass>;
  getClassRoster(classId: string): Promise<ClassRoster>;
  activateClass(classId: string, actorId?: string): Promise<LearningClass>;
  getClassClosureReadiness(classId: string): Promise<ClassClosureReadiness>;
  databaseClassClosureReadiness(
    database: Prisma.TransactionClient,
    classId: string,
  ): Promise<ClassClosureReadiness>;
  closeClass(
    classId: string,
    closeReason: string,
    archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
    actorId?: string,
  ): Promise<LearningClass>;
  reopenClass(
    classId: string,
    rawReason: string,
    actorId?: string,
  ): Promise<LearningClass>;
  listMaterials(
    role: string,
    query?: string,
    actorId?: string,
    page?: number,
  ): Promise<LearningMaterial[]>;
  searchAccessibleMaterials(
    input: {
      query?: string;
      classId?: string;
      courseId?: string;
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
  createMaterial(
    classId: string,
    input: Pick<
      LearningMaterial,
      "name" | "mimeType" | "sizeBytes" | "folder" | "tags"
    >,
    upload?: UploadedMaterialFile,
    actorId?: string,
  ): Promise<LearningMaterial>;
  createMaterialAccess(
    materialId: string,
    role: string,
    action?: MaterialAccessAction,
    actorId?: string,
  ): Promise<{ url: string; expiresAt: string }>;
  readMaterialDownload(
    ...args: Parameters<LearningServiceContext["resolveMaterialDownload"]>
  ): Promise<MaterialDownload>;
  readMaterialDownloadStream(
    ...args: Parameters<LearningServiceContext["resolveMaterialDownload"]>
  ): Promise<{
    stream: ReturnType<typeof createReadStream>;
    size: number;
    fileName: string;
    mimeType: string;
  }>;
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
  updateMaterial(
    materialId: string,
    input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility">>,
    actorId?: string,
  ): Promise<LearningMaterial>;
  listInstructorClassLearners(
    classId: string,
    instructorId: string,
  ): Promise<DirectoryUser[]>;
  searchDirectory(
    roleCode: "INSTRUCTOR" | "LEARNER",
    query?: string,
    classId?: string,
  ): Promise<DirectoryUser[]>;
  listMaterialVersions(
    materialId: string,
    role: string,
    actorId?: string,
  ): Promise<MaterialVersionSnapshot[]>;
  createMaterialVersionAccess(
    materialId: string,
    version: number,
    role: string,
    action?: MaterialAccessAction,
    actorId?: string,
  ): Promise<{ url: string; expiresAt: string }>;
  readMaterialVersionDownload(
    ...args: Parameters<
      LearningServiceContext["resolveMaterialVersionDownload"]
    >
  ): Promise<MaterialDownload>;
  readMaterialVersionDownloadStream(
    ...args: Parameters<
      LearningServiceContext["resolveMaterialVersionDownload"]
    >
  ): Promise<{
    stream: ReturnType<typeof createReadStream>;
    size: number;
    fileName: string;
    mimeType: string;
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
  replaceMaterialVersion(
    materialId: string,
    input: Pick<LearningMaterial, "folder" | "tags">,
    upload: UploadedMaterialFile,
    actorId?: string,
  ): Promise<LearningMaterial>;
  reviewClassMaterial(
    materialId: string,
    action: FileReviewRecord["action"],
    rawReason?: string,
    reviewerId?: string,
  ): Promise<LearningMaterial>;
  listMaterialReviews(materialId: string): Promise<FileReviewRecord[]>;
  listQuestions(
    filters?:
      | string
      | {
          query?: string;
          courseId?: string;
          type?: string;
          difficulty?: number;
          tag?: string;
          status?: LearningQuestion["status"];
        },
  ): Promise<LearningQuestion[]>;
  createQuestion(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId?: string,
  ): Promise<LearningQuestion>;
  updateQuestion(
    questionId: string,
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId?: string,
  ): Promise<LearningQuestion>;
  uploadQuestionImage(
    questionId: string,
    upload: UploadedMaterialFile,
  ): Promise<LearningQuestion>;
  removeQuestionImage(questionId: string): Promise<LearningQuestion>;
  readQuestionImage(
    questionId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload>;
  publishQuestion(
    questionId: string,
    actorId?: string,
  ): Promise<LearningQuestion>;
  reviewQuestion(
    questionId: string,
    decision: "APPROVE" | "RETURN",
    rawNote?: string,
    reviewerId?: string,
  ): Promise<LearningQuestion>;
  importQuestions(
    inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
    authorId?: string,
  ): Promise<QuestionImportResult[]>;
  listExams(role: string, actorId?: string): Promise<LearningExam[]>;
  listLearnerExamSummaries(
    classId?: string,
    learnerId?: string,
  ): Promise<LearnerExamSummary[]>;
  getExamQuestions(
    examId: string,
    learnerId?: string,
  ): Promise<LearningQuestion[]>;
  getInstructorExamPreview(
    examId: string,
    instructorId?: string,
  ): Promise<LearningQuestion[]>;
  getReviewerExamPreview(examId: string): Promise<LearningQuestion[]>;
  createExam(
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & { scoreAllocations?: Array<{ questionId: string; score: number }> },
    actorId?: string,
  ): Promise<LearningExam>;
  updateExam(
    examId: string,
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & {
      scoreAllocations?: Array<{ questionId: string; score: number }>;
      expectedVersion: number;
    },
    actorId?: string,
  ): Promise<LearningExam>;
  editExamQuestion(
    examId: string,
    questionId: string,
    input: {
      content: string;
      options: string[];
      correctAnswers: string[];
      expectedVersion: number;
    },
    actorId: string,
  ): Promise<LearningQuestion>;
  submitExamForReview(
    examId: string,
    actorId?: string,
    confirmQuestions?: boolean,
    expectedVersion?: number,
  ): Promise<LearningExam>;
  reviewExam(
    examId: string,
    decision: ExamApprovalRecord["decision"],
    rawNote?: string,
    reviewerId?: string,
  ): Promise<LearningExam>;
  listExamApprovals(examId: string): Promise<ExamApprovalRecord[]>;
  startAttempt(examId: string, learnerId?: string): Promise<ExamAttempt>;
  saveAnswer(
    attemptId: string,
    questionId: string,
    answers: string[],
    learnerId?: string,
  ): Promise<ExamAttempt>;
  submitAttempt(attemptId: string, learnerId?: string): Promise<ExamAttempt>;
  reconcileExpiredAttempts(limit?: number): Promise<number>;
  getAttempt(attemptId: string): Promise<ExamAttempt>;
  listLearnerResults(learnerId?: string): Promise<LearnerResult[]>;
  getLearnerResult(
    attemptId: string,
    learnerId?: string,
  ): Promise<LearnerResult>;
  requestRegrade(
    attemptId: string,
    reason: string,
    learnerId?: string,
  ): Promise<RegradeRequest>;
  listRegradeRequests(
    actorId?: string,
    status?: RegradeRequest["status"],
  ): Promise<RegradeRequest[]>;
  claimRegrade(requestId: string, actorId?: string): Promise<RegradeRequest>;
  resolveRegrade(
    requestId: string,
    input: {
      decision: "APPROVE" | "REJECT";
      resolution: string;
      score?: number;
      feedback?: string;
      questionScores?: Array<{ questionId: string; score: number }>;
    },
    actorId?: string,
  ): Promise<RegradeRequest>;
  listAttempts(examId?: string, actorId?: string): Promise<ExamAttempt[]>;
  getExamGenerationContext(
    classId: string,
    actorId?: string,
    rawMaterialIds?: string[],
    skipMaterials?: boolean,
  ): Promise<ExamGenerationContext>;
  getGeneratedExamByRequest(
    clientRequestId: string,
    classId: string,
    actorId?: string,
  ): Promise<LearningExam | undefined>;
  createGeneratedExam(
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
    clientRequestId?: string,
    actorId?: string,
  ): Promise<LearningExam>;
  getAttemptReview(
    attemptId: string,
    actorId?: string,
  ): Promise<ExamAttemptReview>;
  gradeAttempt(
    attemptId: string,
    score: number,
    feedback: string,
    correctionReason?: string,
    graderId?: string,
    questionScores?: Array<{ questionId: string; score: number }>,
  ): Promise<ExamAttempt>;
  listGradeHistory(
    attemptId: string,
    actorId?: string,
  ): Promise<GradeHistoryRecord[]>;
  listTopics(role?: string, actorId?: string): Promise<ForumTopic[]>;
  createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId?: string,
    authorRole?: string,
  ): Promise<ForumTopic>;
  moderateTopic(
    topicId: string,
    input: { isLocked?: boolean; isPinned?: boolean; reason: string },
    actorId?: string,
  ): Promise<ForumTopic>;
  listPosts(
    topicId: string,
    role?: string,
    actorId?: string,
  ): Promise<ForumPost[]>;
  createPost(
    topicId: string,
    body: string,
    authorId?: string,
    parentId?: string,
    rawAttachmentIds?: string[],
    rawMentionedUserIds?: string[],
  ): Promise<ForumPost>;
  updatePost(
    postId: string,
    body: string,
    authorId?: string,
  ): Promise<ForumPost>;
  deletePost(postId: string, authorId?: string): Promise<ForumPost>;
  hidePost(
    postId: string,
    rawReason: string,
    actorId?: string,
  ): Promise<ForumPost>;
  listNotifications(recipientId?: string): Promise<LearningNotification[]>;
  markNotificationRead(
    notificationId: string,
    recipientId?: string,
  ): Promise<LearningNotification>;
  reportContent(
    input: Pick<
      ContentReport,
      "targetType" | "targetId" | "reporterId" | "reason" | "details"
    >,
  ): Promise<ContentReport>;
  listReports(): Promise<ContentReport[]>;
  listLearnerReports(learnerId?: string): Promise<ContentReport[]>;
  getReportContext(reportId: string): Promise<ModerationContext>;
  claimReport(
    reportId: string,
    moderatorId?: string,
    moderatorRole?: string,
  ): Promise<ContentReport>;
  resolveReport(
    reportId: string,
    action: "HIDE_CONTENT" | "KEEP_CONTENT" | "ESCALATE_ADMIN",
    resolution: string,
    moderatorId?: string,
    moderatorRole?: string,
  ): Promise<ContentReport>;
  appealReport(
    reportId: string,
    reason: string,
    learnerId?: string,
  ): Promise<ContentReport>;
  listSessions(role?: string, actorId?: string): Promise<LiveSession[]>;
  createSession(
    classId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">,
    actorId?: string,
    actorRole?: string,
  ): Promise<LiveSession>;
  updateSession(
    sessionId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      reason: string;
    },
    actorId?: string,
  ): Promise<LiveSession>;
  cancelSession(
    sessionId: string,
    reason: string,
    actorId?: string,
  ): Promise<LiveSession>;
  transitionSession(
    sessionId: string,
    status: LiveSession["status"],
    actorId?: string,
  ): Promise<LiveSession>;
  joinSession(
    sessionId: string,
    learnerId?: string,
  ): Promise<{ attendeeUrl: string; joinedAt: string }>;
  leaveSession(
    sessionId: string,
    learnerId?: string,
  ): Promise<AttendanceRecord>;
  updateAttendance(
    sessionId: string,
    learnerId: string,
    status: AttendanceRecord["status"],
    attendedMinutes: number,
    adjustmentReason: string,
    actorId?: string,
  ): Promise<AttendanceRecord>;
  getAttendanceReview(sessionId: string): Promise<AttendanceSessionReview>;
  syncAttendance(
    sessionId: string,
    inputRecords: ProviderAttendanceInput[],
    actorId?: string,
  ): Promise<{ review: AttendanceSessionReview; skippedLearnerIds: string[] }>;
  lockAttendance(sessionId: string, actorId?: string): Promise<LiveSession>;
  resolveAttendanceAppeal(
    appealId: string,
    decision: "APPROVE" | "REJECT",
    resolution: string,
    status?: AttendanceRecord["status"],
    attendedMinutes?: number,
    actorId?: string,
  ): Promise<AttendanceAppeal>;
  attachRecording(
    sessionId: string,
    recordingUrl: string,
    actorId?: string,
  ): Promise<LiveSession>;
  completeRecording(
    sessionId: string,
    status: "READY" | "FAILED",
    retentionDays?: number,
    errorMessage?: string,
    actorId?: string,
  ): Promise<LiveSession>;
  isRecordingAvailable(
    session: Pick<
      LiveSession,
      "recordingUrl" | "recordingStatus" | "recordingExpiresAt"
    >,
  ): boolean;
  getSessionSummary(sessionId: string, learnerId?: string): Promise<object>;
  createRecordingAccess(
    sessionId: string,
    learnerId?: string,
  ): Promise<{ url: string; expiresAt: string }>;
  resolveRecordingAccess(
    sessionId: string,
    expires: number,
    signature: string,
    learnerId?: string,
  ): Promise<{ recordingUrl: string }>;
  requestAttendanceAppeal(
    sessionId: string,
    reason: string,
    learnerId?: string,
  ): Promise<AttendanceAppeal>;
  listTickets(role: string, actorId?: string): Promise<SupportTicket[]>;
  createTicket(
    input: Pick<
      SupportTicket,
      "category" | "severity" | "description" | "contextId"
    > & { clientRequestId?: string },
    reporterId?: string,
  ): Promise<SupportTicket>;
  listRoleNotifications(role: string): Promise<LearningNotification[]>;
  markRoleNotificationRead(
    notificationId: string,
    role: string,
  ): Promise<LearningNotification>;
  addSupportAttachment(
    ticketId: string,
    upload: UploadedMaterialFile,
    role: string,
    uploaderId?: string,
  ): Promise<SupportAttachment>;
  readSupportAttachment(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId?: string,
  ): Promise<MaterialDownload>;
  updateTicket(
    ticketId: string,
    input: Partial<
      Pick<SupportTicket, "status" | "assigneeId" | "resolution">
    > & { expectedUpdatedAt?: string },
    actorId?: string,
  ): Promise<SupportTicket>;
  closeTicketByReporter(
    ticketId: string,
    reporterId?: string,
  ): Promise<SupportTicket>;
  listTicketComments(
    ticketId: string,
    role: string,
    actorId?: string,
  ): Promise<TicketComment[]>;
  addTicketComment(
    ticketId: string,
    body: string,
    role: string,
    authorId?: string,
  ): Promise<TicketComment>;
  getClassProgress(
    classId: string,
    input: { from?: string; to?: string } & Partial<RiskThresholds>,
  ): Promise<ClassProgressReport>;
  createProgressIntervention(
    classId: string,
    input: Pick<
      ProgressIntervention,
      "learnerId" | "title" | "notes" | "dueAt"
    > & { assigneeId: string },
    createdById?: string,
  ): Promise<ProgressIntervention>;
  listMyProgressInterventions(ownerId: string): Promise<ProgressIntervention[]>;
  updateProgressIntervention(
    interventionId: string,
    input: {
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
      outcome?: string;
      cancellationReason?: string;
    },
    actorId?: string,
    actorRole?: string,
  ): Promise<ProgressIntervention>;
  transferProgressIntervention(
    interventionId: string,
    assigneeId: string,
    rawReason: string,
    actorId?: string,
  ): Promise<ProgressIntervention>;
  runOperationalReport(
    fromInput: string,
    toInput: string,
    requestedById?: string,
  ): Promise<ReportRun>;
  createReportExport(
    reportRunId: string,
    format: "CSV",
    requestedById?: string,
  ): Promise<ReportExport>;
  listReportExports(requestedById?: string): Promise<ReportExport[]>;
  downloadReportExport(
    exportId: string,
    requestedById?: string,
  ): Promise<MaterialDownload>;
  getOperationalReport(
    fromInput?: string,
    toInput?: string,
  ): Promise<OperationalReport>;
  getClassReports(): Promise<object[]>;
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
  exportExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId?: string,
  ): Promise<Buffer>;
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
  assertMaterialClassAccess(
    classItem: {
      enrollments: Array<{ learnerId: string; status: string }>;
      instructors: Array<{ instructorId: string }>;
    },
    role: string,
    actorId: string,
  ): void;
  assertMemoryMaterialClassAccess(
    classId: string,
    role: string,
    actorId: string,
  ): void;
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
