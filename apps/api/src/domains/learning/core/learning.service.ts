import * as folderOps from "../operations/materials/class-folders.js";
import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { listExamPage, type ExamPage, type ExamPageQuery } from "../operations/exams/learning-exam-page.js";
import type { PaginatedResult } from "../../../common/pagination.js";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import type { Environment } from "../../../config/environment.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { DEFAULT_MATERIAL_MIME_TYPES } from "../../../infrastructure/file-transfer.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import {
  ObjectStorageService,
  type StoredObject,
} from "../../../infrastructure/object-storage.service.js";
import type { ScannedQuestionDraft } from "../../system/ai/ai-provider.service.js";
import {
  SystemService,
} from "../../system/core/system.service.js";
import type { LearningServiceContext } from "./learning.context.js";
import type { AttachmentDocumentPreview } from "../academic/academic.shared.js";
import { type AttemptWithAnswers, type ClassWithMembers, type ExamGenerationContext, type ExamWithQuestions, type ForumPostWithRelations, type MaterialAccessAction, type MaterialDownload, type MaterialSearchResult, type MaterialSummaryBucket, type MemoryQuestionImage, now, type QuestionSummary, type SupportTicketWithAttachments, type UploadedMaterialFile } from "./learning.shared.js";
import type { ClassCapabilities, ClassClosureReadiness, ClassProgressReport, ClassRoster, CourseVersionSnapshot, DirectoryUser, EnrollmentImportResult, ExamAnalytics, ExamAttempt, ExamAttemptReview, ForumPost, ForumTopic, InstructorRole, LearnerExamSummary, LearnerProgress, LearnerResult, LearningClass, LearningCourse, LearningExam, LearningMaterial, LearningNotification, LearningQuestion, LiveSession, ProgressIntervention, QuestionImportResult, RegradeRequest, RiskThresholds, SupportAttachment, SupportTicket, TicketComment } from "./learning.types.js";
import * as access_ops from "../operations/access/learning-access.js";
import * as analytics_ops from "../operations/analytics/learning-analytics.js";
import * as attempts_ops from "../operations/exams/learning-attempts.js";

import * as class_enrollments_ops from "../operations/classes/learning-class-enrollments.js";
import * as class_instructors_ops from "../operations/classes/learning-class-instructors.js";
import * as class_lifecycle_ops from "../operations/classes/learning-class-lifecycle.js";
import * as class_rules_ops from "../operations/classes/learning-class-rules.js";
import * as classes_ops from "../operations/classes/learning-classes.js";
import * as content_rules_ops from "../operations/content/learning-content-rules.js";
import * as courses_ops from "../operations/courses/learning-courses.js";
import * as directory_ops from "../operations/directory/learning-directory.js";
import * as engagement_mapping_ops from "../operations/engagement/learning-engagement-mapping.js";
import * as exam_approval_ops from "../operations/exams/learning-exam-approval.js";
import * as exam_editing_ops from "../operations/exams/learning-exam-editing.js";
import * as exam_generation_ops from "../operations/exams/learning-exam-generation.js";
import * as exams_ops from "../operations/exams/learning-exams.js";
import * as file_rules_ops from "../operations/materials/learning-file-rules.js";
import * as forum_rules_ops from "../operations/forum/learning-forum-rules.js";
import * as forum_ops from "../operations/forum/learning-forum.js";
import * as grading_ops from "../operations/grading/learning-grading.js";
import * as live_sessions_ops from "../operations/live/learning-live-sessions.js";
import * as lookups_ops from "../operations/support/learning-lookups.js";
import * as mapping_ops from "../operations/mapping/learning-mapping.js";
import * as material_downloads_ops from "../operations/materials/learning-material-downloads.js";
import * as materials_ops from "../operations/materials/learning-materials.js";
import * as moderation_ops from "../operations/moderation/learning-moderation.js";
import * as progress_ops from "../operations/progress/learning-progress.js";
import * as providers_ops from "../operations/support/learning-providers.js";
import * as question_rules_ops from "../operations/questions/learning-question-rules.js";
import * as questions_ops from "../operations/questions/learning-questions.js";
import * as recordings_ops from "../operations/live/learning-recordings.js";
import * as regrades_ops from "../operations/grading/learning-regrades.js";
import * as report_rules_ops from "../operations/reports/learning-report-rules.js";

import * as result_mapping_ops from "../operations/mapping/learning-result-mapping.js";
import * as session_mapping_ops from "../operations/mapping/learning-session-mapping.js";
import * as storage_ops from "../operations/storage/learning-storage.js";
import * as support_ops from "../operations/support/learning-support.js";
export * from "./learning.shared.js";
export type { ForumPostPageResult } from "../operations/forum/learning-forum.js";

@Injectable()
/** Điều phối toàn bộ nghiệp vụ đào tạo, có đường chạy Prisma và fallback in-memory cho môi trường demo. */
export class LearningService {
  private readonly courses: LearningCourse[] = [
    {
      id: "course-web",
      code: "WEB-FULLSTACK",
      name: "Phát triển Web Full-stack",
      description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.",
      outcomes: [
        "Thiết kế giao diện responsive",
        "Xây dựng REST API",
        "Thiết kế cơ sở dữ liệu",
      ],
      status: "PUBLISHED",
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "course-data",
      code: "DATA-FOUNDATION",
      name: "Nền tảng dữ liệu",
      description: "Tổ chức, phân tích và trực quan hóa dữ liệu.",
      outcomes: ["Làm sạch dữ liệu", "Mô hình hóa dữ liệu"],
      status: "DRAFT",
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  private readonly courseVersions: CourseVersionSnapshot[] = [
    {
      id: "course-version-web-1",
      courseId: "course-web",
      version: 1,
      name: "Phát triển Web Full-stack",
      description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.",
      outcomes: [
        "Thiết kế giao diện responsive",
        "Xây dựng REST API",
        "Thiết kế cơ sở dữ liệu",
      ],
      publishedBy: "usr-manager",
      publishedAt: now(),
    },
  ];

  private readonly classes: LearningClass[] = [
    {
      id: "class-web-01",
      courseId: "course-web",
      courseVersion: 1,
      code: "WEB-K01",
      name: "Web Full-stack K01",
      term: "2026-HK1",
      startAt: "2026-08-18T01:00:00.000Z",
      endAt: "2026-12-20T10:00:00.000Z",
      capacity: 40,
      timezone: "Asia/Bangkok",
      allowLateEnrollment: true,
      status: "ACTIVE",
      instructorIds: ["usr-instructor"],
      learnerIds: ["usr-learner"],
    },
  ];

  private readonly folderRegistry = new Map<string, Set<string>>([
    [JSON.stringify(["class-web-01", "materials"]), new Set(["Tài liệu chung", "Tài liệu", "Bài tập tự luận", "Tuần 1", "Tuần 2"])],
    [JSON.stringify(["class-web-01", "lectures"]), new Set(["Bài giảng chung", "Bài giảng"])],
  ]);
  private readonly materials: LearningMaterial[] = [
    {
      id: "mat-web-intro",
      classId: "class-web-01",
      ownerId: "usr-instructor",
      name: "01 — Tổng quan kiến trúc Web.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_420_000,
      folder: "Tuần 1",
      tags: ["kiến trúc", "bắt đầu"],
      version: 1,
      visibility: "PUBLISHED",
      scope: "CLASS",
      createdAt: now(),
    },
    {
      id: "mat-api-guide",
      classId: "class-web-01",
      ownerId: "usr-instructor",
      name: "02 — Thiết kế REST API.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_180_000,
      folder: "Tuần 2",
      tags: ["api", "backend"],
      version: 2,
      visibility: "PUBLISHED",
      scope: "CLASS",
      createdAt: now(),
    },
  ];

  private readonly questions: LearningQuestion[] = [
    {
      id: "q-rest-01",
      familyId: "q-rest-01",
      courseId: "course-web",
      type: "SINGLE_CHOICE",
      content: "HTTP method nào phù hợp để cập nhật một phần tài nguyên?",
      options: ["GET", "POST", "PATCH", "DELETE"],
      correctAnswers: ["PATCH"],
      difficulty: 1,
      tags: ["http", "api"],
      status: "PUBLISHED",
      version: 1,
    },
    {
      id: "q-db-01",
      familyId: "q-db-01",
      courseId: "course-web",
      type: "TRUE_FALSE",
      content: "Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu.",
      options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"],
      difficulty: 1,
      tags: ["database"],
      status: "PUBLISHED",
      version: 1,
    },
  ];

  private readonly questionImages = new Map<string, MemoryQuestionImage>();

  private readonly exams: LearningExam[] = [
    {
      id: "exam-mid-web",
      classId: "class-web-01",
      title: "Kiểm tra giữa kỳ Web Full-stack",
      questionIds: ["q-rest-01", "q-db-01"],
      durationMinutes: 45,
      totalScore: 10,
      openAt: "2026-08-20T00:00:00.000Z",
      closeAt: "2026-12-30T23:59:00.000Z",
      attemptLimit: 2,
      status: "PUBLISHED",
      version: 1,
    },
  ];

  private readonly attempts: ExamAttempt[] = [];
  private readonly receiptFallbackSecret = randomBytes(32).toString("hex");


  private readonly regradeRequests: RegradeRequest[] = [];

  private readonly topics: ForumTopic[] = [
    {
      id: "topic-rest",
      classId: "class-web-01",
      title: "Thảo luận: REST hay GraphQL?",
      body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.",
      authorId: "usr-instructor",
      tags: ["api", "thảo luận"],
      isPinned: true,
      isLocked: false,
      status: "VISIBLE",
      createdAt: now(),
    },
  ];

  private readonly posts: ForumPost[] = [
    {
      id: "post-rest-01",
      topicId: "topic-rest",
      authorId: "usr-learner",
      body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.",
      status: "VISIBLE",
      attachmentIds: [],
      mentionedUserIds: [],
      createdAt: now(),
    },
  ];

  private readonly notifications: LearningNotification[] = [];

  private readonly sessions: LiveSession[] = [
    {
      id: "session-web-01",
      classId: "class-web-01",
      hostId: "usr-instructor",
      title: "Thiết kế API có version",
      startsAt: "2026-08-26T02:00:00.000Z",
      endsAt: "2026-08-26T03:30:00.000Z",
      provider: "JITSI",
      requestedProvider: "JITSI",
      fallbackUsed: false,
      provisioningAttempts: 1,
      status: "SCHEDULED",
      timezone: "Asia/Bangkok",
      hostUrl: "https://meet.jit.si/wind-web-01-host",
      attendeeUrl: "https://meet.jit.si/wind-web-01",
    },
  ];

  private readonly tickets: SupportTicket[] = [];

  private readonly ticketComments: TicketComment[] = [];

  private readonly supportAttachmentFiles = new Map<string, string>();

  private readonly materialFiles = new Map<
    string,
    { objectKey: string; checksum: string }
  >();

  private readonly progressInterventions: ProgressIntervention[] = [];

  private readonly instructorRoles = new Map<string, InstructorRole>([
    ["class-web-01:usr-instructor", "PRIMARY"],
  ]);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
    @Optional() private readonly objectStorage?: ObjectStorageService,
    @Optional() private readonly antivirus?: AntivirusService,
    @Optional() private readonly system?: SystemService,
  ) {}

  private readonly operationContext: LearningServiceContext =
    LearningService.createOperationContext(this);

  /** Cấp quyền truy cập có kiểu cho thao tác nội bộ, giữ nguyên trạng thái và điểm chặn kiểm thử của service. */
  private static createOperationContext(
    owner: LearningService,
  ): LearningServiceContext {
    return {
      get courses(): LearningServiceContext["courses"] {
        return owner.courses;
      },
      get courseVersions(): LearningServiceContext["courseVersions"] {
        return owner.courseVersions;
      },
      get classes(): LearningServiceContext["classes"] {
        return owner.classes;
      },
      folderRegistry: owner.folderRegistry,
      get materials(): LearningServiceContext["materials"] {
        return owner.materials;
      },
      get questions(): LearningServiceContext["questions"] {
        return owner.questions;
      },
      get questionImages(): LearningServiceContext["questionImages"] {
        return owner.questionImages;
      },
      get exams(): LearningServiceContext["exams"] {
        return owner.exams;
      },
      get attempts(): LearningServiceContext["attempts"] {
        return owner.attempts;
      },
      get regradeRequests(): LearningServiceContext["regradeRequests"] {
        return owner.regradeRequests;
      },
      get topics(): LearningServiceContext["topics"] {
        return owner.topics;
      },
      get posts(): LearningServiceContext["posts"] {
        return owner.posts;
      },
      get notifications(): LearningServiceContext["notifications"] {
        return owner.notifications;
      },
      get sessions(): LearningServiceContext["sessions"] {
        return owner.sessions;
      },
      get tickets(): LearningServiceContext["tickets"] {
        return owner.tickets;
      },
      get ticketComments(): LearningServiceContext["ticketComments"] {
        return owner.ticketComments;
      },
      get supportAttachmentFiles(): LearningServiceContext["supportAttachmentFiles"] {
        return owner.supportAttachmentFiles;
      },
      get materialFiles(): LearningServiceContext["materialFiles"] {
        return owner.materialFiles;
      },
      get progressInterventions(): LearningServiceContext["progressInterventions"] {
        return owner.progressInterventions;
      },
      get instructorRoles(): LearningServiceContext["instructorRoles"] {
        return owner.instructorRoles;
      },
      get prisma(): LearningServiceContext["prisma"] {
        return owner.prisma;
      },
      get config(): LearningServiceContext["config"] {
        return owner.config;
      },
      get objectStorage(): LearningServiceContext["objectStorage"] {
        return owner.objectStorage;
      },
      get antivirus(): LearningServiceContext["antivirus"] {
        return owner.antivirus;
      },
      get system(): LearningServiceContext["system"] {
        return owner.system;
      },
      enrollLearner: (...args) => owner.enrollLearner(...args),
      getClassClosureReadiness: (...args) =>
        owner.getClassClosureReadiness(...args),
      databaseClassClosureReadiness: (...args) =>
        owner.databaseClassClosureReadiness(...args),
      getMaterialSummary: (...args) => owner.getMaterialSummary(...args),
      searchAccessibleMaterials: (...args) =>
        owner.searchAccessibleMaterials(...args),
      resolveMaterialDownload: (...args) =>
        owner.resolveMaterialDownload(...args),
      createQuestion: (...args) => owner.createQuestion(...args),
      submitAttempt: (...args) => owner.submitAttempt(...args),
      listLearnerResults: (...args) => owner.listLearnerResults(...args),
      gradeAttempt: (...args) => owner.gradeAttempt(...args),
      listNotifications: (...args) => owner.listNotifications(...args),
      markNotificationRead: (...args) => owner.markNotificationRead(...args),
      isRecordingAvailable: (...args) => owner.isRecordingAvailable(...args),
      database: (...args) => owner.database(...args),
      mapCourse: (...args) => owner.mapCourse(...args),
      mapClass: (...args) => owner.mapClass(...args),
      mapMaterial: (...args) => owner.mapMaterial(...args),
      mapQuestion: (...args) => owner.mapQuestion(...args),
      getExamAnalytics: (...args) => owner.getExamAnalytics(...args),
      cloneQuestion: (...args) => owner.cloneQuestion(...args),
      latestQuestionVersions: (...args) =>
        owner.latestQuestionVersions(...args),
      sameGeneratedQuestion: (...args) => owner.sameGeneratedQuestion(...args),
      questionContentHash: (...args) => owner.questionContentHash(...args),
      validateQuestionInput: (...args) => owner.validateQuestionInput(...args),
      validateSubmittedAnswers: (...args) =>
        owner.validateSubmittedAnswers(...args),
      isQuestionAnswerCorrect: (...args) =>
        owner.isQuestionAnswerCorrect(...args),
      mapExam: (...args) => owner.mapExam(...args),
      mapAttempt: (...args) => owner.mapAttempt(...args),
      submissionReceipt: (...args) => owner.submissionReceipt(...args),
      mapRegradeRequest: (...args) => owner.mapRegradeRequest(...args),
      mapTopic: (...args) => owner.mapTopic(...args),
      mapPost: (...args) => owner.mapPost(...args),
      mapProgressIntervention: (...args) =>
        owner.mapProgressIntervention(...args),
      progressInterventionHistory: (...args) =>
        owner.progressInterventionHistory(...args),
      reportingPeriod: (...args) => owner.reportingPeriod(...args),
      validateRiskThresholds: (...args) =>
        owner.validateRiskThresholds(...args),
      validateTimezone: (...args) => owner.validateTimezone(...args),
      percentage: (...args) => owner.percentage(...args),
      latestDate: (...args) => owner.latestDate(...args),
      buildLearnerProgress: (...args) => owner.buildLearnerProgress(...args),
      buildProviderUrls: (...args) => owner.buildProviderUrls(...args),
      seededOrder: (...args) => owner.seededOrder(...args),
      resolveExamScoreAllocations: (...args) =>
        owner.resolveExamScoreAllocations(...args),
      examQuestionScore: (...args) => owner.examQuestionScore(...args),
      provisionProviderMeeting: (...args) =>
        owner.provisionProviderMeeting(...args),
      userIdsForRole: (...args) => owner.userIdsForRole(...args),
      notifyClassMembers: (...args) => owner.notifyClassMembers(...args),
      mapSession: (...args) => owner.mapSession(...args),
      mapTicket: (...args) => owner.mapTicket(...args),
      isLiveProvider: (value: string): value is LiveSession["provider"] =>
        owner.isLiveProvider(value),
      buildClassClosureReadiness: (...args) =>
        owner.buildClassClosureReadiness(...args),
      getDatabaseClass: (...args) => owner.getDatabaseClass(...args),
      getDatabaseExam: (...args) => owner.getDatabaseExam(...args),
      getDatabaseAttempt: (...args) => owner.getDatabaseAttempt(...args),
      requireUserRole: (...args) => owner.requireUserRole(...args),
      getStoragePolicy: (...args) => owner.getStoragePolicy(...args),
      storeUpload: (...args) => owner.storeUpload(...args),
      writeStoredFile: (...args) => owner.writeStoredFile(...args),
      removeStoredFile: (...args) => owner.removeStoredFile(...args),
      removeQuestionObjectIfUnreferenced: (...args) =>
        owner.removeQuestionObjectIfUnreferenced(...args),
      resolveObjectPath: (...args) => owner.resolveObjectPath(...args),
      signMaterialAccess: (...args) => owner.signMaterialAccess(...args),
      signRecordingAccess: (...args) => owner.signRecordingAccess(...args),
      verifyExpiringSignature: (...args) =>
        owner.verifyExpiringSignature(...args),
      verifyMaterialAccess: (...args) => owner.verifyMaterialAccess(...args),
      userIdForRole: (...args) => owner.userIdForRole(...args),
      readStoredFile: (...args) => owner.readStoredFile(...args),
      isMaterialObjectKey: (...args) => owner.isMaterialObjectKey(...args),
      canManageSupport: (...args) => owner.canManageSupport(...args),
      canAccessMemoryMaterial: (...args) =>
        owner.canAccessMemoryMaterial(...args),
      examAvailability: (...args) => owner.examAvailability(...args),
      attemptDeadline: (...args) => owner.attemptDeadline(...args),
      isMemoryAnswerCorrect: (...args) => owner.isMemoryAnswerCorrect(...args),
      validateForumContent: (...args) => owner.validateForumContent(...args),
      validateSupportText: (...args) => owner.validateSupportText(...args),
      validateSupportUpload: (...args) => owner.validateSupportUpload(...args),
      detectMaliciousUpload: (...args) => owner.detectMaliciousUpload(...args),
      validateQuestionImage: (...args) => owner.validateQuestionImage(...args),
      scanUpload: (...args) => owner.scanUpload(...args),
      assertForumClassAccess: (...args) =>
        owner.assertForumClassAccess(...args),
      assertMemoryForumClassAccess: (...args) =>
        owner.assertMemoryForumClassAccess(...args),
      toStringArray: (...args) => owner.toStringArray(...args),
      findCourse: (...args) => owner.findCourse(...args),
      findClass: (...args) => owner.findClass(...args),
      findExam: (...args) => owner.findExam(...args),
      findAttempt: (...args) => owner.findAttempt(...args),
      findTopic: (...args) => owner.findTopic(...args),
      findPost: (...args) => owner.findPost(...args),
      findSession: (...args) => owner.findSession(...args),
    };
  }

  /** Liệt kê khóa học từ DB hoặc trả bản sao dữ liệu nhớ để tránh mutation ngoài service. */
  async listCourses(): Promise<LearningCourse[]> {
    return await courses_ops.listCourses(this.operationContext);
  }

  /** Phân trang danh mục khóa học kèm tổng số bản ghi được lọc trực tiếp từ DB. */
  async listCoursesPage(
    filters: courses_ops.CoursePageFilters = {},
  ): Promise<PaginatedResult<LearningCourse>> {
    return await courses_ops.listCoursesPage(this.operationContext, filters);
  }

  /** Tạo khóa học nháp sau khi chuẩn hóa mã và chống trùng, đồng thời ghi audit. */
  async createCourse(
    input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes"> &
      Partial<Pick<LearningCourse, "grade" | "subject">>,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.createCourse(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Cập nhật nội dung khóa học; khóa học đã xuất bản sẽ tăng version theo quy tắc lưu lịch sử. */
  async updateCourse(
    courseId: string,
    input: Pick<LearningCourse, "name" | "description" | "outcomes">,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.updateCourse(
      this.operationContext,
      courseId,
      input,
      actorId,
    );
  }

  /** Liệt kê snapshot xuất bản của khóa học theo thứ tự phiên bản. */
  async listCourseVersions(courseId: string): Promise<CourseVersionSnapshot[]> {
    return await courses_ops.listCourseVersions(
      this.operationContext,
      courseId,
    );
  }

  /** Xuất bản khóa học và chụp snapshot bất biến của phiên bản hiện tại trong transaction. */
  async publishCourse(
    courseId: string,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.publishCourse(
      this.operationContext,
      courseId,
      actorId,
    );
  }

  /** Chuyển khóa học sang ARCHIVED sau khi kiểm tra ràng buộc sử dụng và lưu lý do audit. */
  async archiveCourse(
    courseId: string,
    reason: string,
    actorId: string,
  ): Promise<LearningCourse> {
    return await courses_ops.archiveCourse(
      this.operationContext,
      courseId,
      reason,
      actorId,
    );
  }

  /** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
  async listClasses(
    role: string,
    actorId: string,
  ): Promise<LearningClass[]> {
    return await classes_ops.listClasses(this.operationContext, role, actorId);
  }

  /** Đọc chi tiết đúng một lớp học theo quyền và quan hệ thành viên của phiên hiện tại. */
  async getClassById(
    classId: string,
    role: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await classes_ops.getClassById(this.operationContext, classId, role, actorId);
  }

  /** Phân trang danh sách lớp học theo vai trò và bộ lọc trực tiếp ở DB. */
  async listClassesPage(
    role: string,
    actorId: string,
    filters: classes_ops.ClassPageFilters = {},
  ): Promise<PaginatedResult<LearningClass>> {
    return await classes_ops.listClassesPage(
      this.operationContext,
      role,
      actorId,
      filters,
    );
  }

  /** Tính capability tại máy chủ từ quyền phiên, quan hệ lớp và trạng thái thay vì tên vai trò đơn lẻ. */
  async getClassCapabilities(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<ClassCapabilities> {
    return await classes_ops.getClassCapabilities(
      this.operationContext,
      classId,
      session,
    );
  }

  /** Tạo lớp nháp từ phiên bản khóa học hợp lệ và kiểm tra lịch, sức chứa, múi giờ. */
  async createClass(
    input: Pick<
      LearningClass,
      "courseId" | "code" | "name" | "term" | "startAt" | "endAt" | "capacity"
    > &
      Partial<Pick<LearningClass, "timezone" | "allowLateEnrollment" | "grade" | "subject">>,
    actorId: string,
  ): Promise<LearningClass> {
    return await classes_ops.createClass(this.operationContext, input, actorId);
  }

  /** Cập nhật thông tin và cài đặt lớp học. */
  async updateClass(
    classId: string,
    input: { name?: string; capacity?: number; allowLateEnrollment?: boolean; allowPeerGradeViewing?: boolean },
    actorId: string,
  ): Promise<LearningClass> {
    return await classes_ops.updateClass(this.operationContext, classId, input, actorId);
  }

  /** Gán giảng viên đúng role, bảo đảm người dùng có vai trò INSTRUCTOR và ghi lịch sử thành viên. */
  async assignInstructor(
    classId: string,
    instructorId: string,
    requestedRole: InstructorRole | undefined,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_instructors_ops.assignInstructor(
      this.operationContext,
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
    rawReason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_instructors_ops.transferPrimaryInstructor(
      this.operationContext,
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
    reason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_instructors_ops.removeInstructor(
      this.operationContext,
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
    return await class_enrollments_ops.enrollLearner(
      this.operationContext,
      classId,
      learnerId,
      actorId,
    );
  }

  /** Ghi danh lần lượt danh sách userId và cô lập lỗi để trả kết quả trên từng học viên. */
  async importEnrollments(
    classId: string,
    userIds: string[],
    actorId: string,
  ): Promise<EnrollmentImportResult[]> {
    return await class_enrollments_ops.importEnrollments(
      this.operationContext,
      classId,
      userIds,
      actorId,
    );
  }

  /** Hủy ghi danh và ghi nhận lý do trực tiếp trên bản ghi ghi danh lớp. */
  async removeEnrollment(
    classId: string,
    learnerId: string,
    reason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_enrollments_ops.removeEnrollment(
      this.operationContext,
      classId,
      learnerId,
      reason,
      actorId,
    );
  }

  /** Tổng hợp giảng viên, ghi danh đang/cũ và lịch sử thao tác thành roster chi tiết. */
  async getClassRoster(classId: string): Promise<ClassRoster> {
    return await class_enrollments_ops.getClassRoster(
      this.operationContext,
      classId,
    );
  }

  /** Kích hoạt lớp khi khóa học đã xuất bản, lịch hợp lệ và có giảng viên chính. */
  async activateClass(
    classId: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_lifecycle_ops.activateClass(
      this.operationContext,
      classId,
      actorId,
    );
  }

  /** Đếm các nghiệp vụ còn mở để xác định lớp có thể đóng hay chưa. */
  async getClassClosureReadiness(
    classId: string,
  ): Promise<ClassClosureReadiness> {
    return await class_lifecycle_ops.getClassClosureReadiness(
      this.operationContext,
      classId,
    );
  }

  /** Tính lại mọi blocker trong chính transaction đóng lớp để loại cửa sổ cạnh tranh với lệnh tạo/nộp. */
  private async databaseClassClosureReadiness(
    database: Prisma.TransactionClient,
    classId: string,
  ): Promise<ClassClosureReadiness> {
    return await class_lifecycle_ops.databaseClassClosureReadiness(
      this.operationContext,
      database,
      classId,
    );
  }

  /** Đóng lớp chỉ khi readiness không còn blocker và lưu chính sách lưu trữ. */
  async closeClass(
    classId: string,
    closeReason: string,
    archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
    actorId: string,
  ): Promise<LearningClass> {
    return await class_lifecycle_ops.closeClass(
      this.operationContext,
      classId,
      closeReason,
      archivePolicy,
      actorId,
    );
  }

  /** Mở lại lớp đã đóng, xóa thông tin đóng và ghi lý do vào audit. */
  async reopenClass(
    classId: string,
    rawReason: string,
    actorId: string,
  ): Promise<LearningClass> {
    return await class_lifecycle_ops.reopenClass(
      this.operationContext,
      classId,
      rawReason,
      actorId,
    );
  }

  /** Đọc hoặc tạo thư mục trong lớp được phân công. */
  async classFolders(
    classId: string,
    actorId: string,
    input: { kind: string; name: string } | undefined,
    actorRole: string,
  ): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
    return folderOps.classFolders(this.operationContext, classId, actorId, input, actorRole);
  }

  /** Liệt kê danh sách học liệu hiển thị theo phạm vi quyền của vai trò hiện tại. */
  async listMaterials(
    role: string,
    query: string | undefined,
    actorId: string,
    page = 1,
    materialId?: string,
  ): Promise<LearningMaterial[]> {
    return await materials_ops.listMaterials(
      this.operationContext,
      role,
      query,
      actorId,
      page,
      materialId,
    );
  }

  /** Tổng hợp nhanh số lượng học liệu theo lớp, thư mục và loại nội dung. */
  async getMaterialSummary(
    actorId: string,
    role: string,
    classId?: string,
  ): Promise<MaterialSummaryBucket[]> {
    return await materials_ops.getMaterialSummary(
      this.operationContext,
      actorId,
      role,
      classId,
    );
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
    return await materials_ops.searchAccessibleMaterials(
      this.operationContext,
      input,
      learnerId,
      role,
    );
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
    return await materials_ops.createMaterial(
      this.operationContext,
      classId,
      input,
      upload,
      actorId,
      actorRole,
    );
  }

  /** Phát URL truy cập học liệu ký HMAC có thời hạn sau khi kiểm tra quyền. */
  async createMaterialAccess(
    materialId: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return await material_downloads_ops.createMaterialAccess(
      this.operationContext,
      materialId,
      role,
      action,
      actorId,
    );
  }

  /** Giữ API đọc bộ đệm cho tác vụ nội bộ và kiểm thử với xác minh checksum. */
  async readMaterialDownload(
    ...args: Parameters<LearningService["resolveMaterialDownload"]>
  ): Promise<MaterialDownload> {
    return await material_downloads_ops.readMaterialDownload(
      this.operationContext,
      ...args,
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
    return await material_downloads_ops.readMaterialDownloadStream(
      this.operationContext,
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
    return await material_downloads_ops.readMaterialPreviewContent(
      this.operationContext,
      materialId,
      role,
      actorId,
    );
  }

  /** Xác minh chữ ký/quyền và lấy vị trí object, không nạp toàn bộ nội dung vào RAM. */
  private async resolveMaterialDownload(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
  ): Promise<{
    fileName: string;
    mimeType: string;
    objectKey: string;
    checksum?: string;
  }> {
    return await material_downloads_ops.resolveMaterialDownload(
      this.operationContext,
      materialId,
      expires,
      signature,
      role,
      action,
      actorId,
    );
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
    return await materials_ops.updateMaterial(
      this.operationContext,
      materialId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Người tải lên xóa hẳn học liệu cùng mọi phiên bản và tệp. */
  async deleteMaterial(materialId: string, actorId: string, actorRole: string): Promise<void> {
    return await materials_ops.deleteMaterial(
      this.operationContext,
      materialId,
      actorId,
      actorRole,
    );
  }

  /** Xác minh giảng viên phụ trách rồi trả học viên đang ghi danh trong lớp. */
  async listInstructorClassLearners(
    classId: string,
    instructorId: string,
  ): Promise<DirectoryUser[]> {
    return await directory_ops.listInstructorClassLearners(
      this.operationContext,
      classId,
      instructorId,
    );
  }

  /** Tìm người dùng theo vai trò và tùy chọn loại các thành viên đã thuộc lớp. */
  async searchDirectory(
    roleCode: "INSTRUCTOR" | "LEARNER",
    query = "",
    classId?: string,
  ): Promise<DirectoryUser[]> {
    return await directory_ops.searchDirectory(
      this.operationContext,
      roleCode,
      query,
      classId,
    );
  }

  /** Quét và thay trực tiếp tệp hiện tại của học liệu, xóa ngay tệp cũ sau khi lưu xong. */
  async replaceMaterialFile(
    materialId: string,
    input: Pick<LearningMaterial, "folder" | "tags">,
    upload: UploadedMaterialFile,
    actorId: string,
  ): Promise<LearningMaterial> {
    return await materials_ops.replaceMaterialFile(
      this.operationContext,
      materialId,
      input,
      upload,
      actorId,
    );
  }

  /** Lọc phiên bản câu hỏi mới nhất theo từ khóa, khóa học, loại, độ khó, tag và trạng thái. */
  async listQuestions(
    filters: string | questions_ops.QuestionListFilters,
    scope: questions_ops.QuestionScope,
  ): Promise<LearningQuestion[]> {
    return await questions_ops.listQuestions(this.operationContext, filters, scope);
  }

  /** Phân trang phiên bản mới nhất mỗi family câu hỏi trực tiếp bằng SQL CTE trong phạm vi của người gọi. */
  async listQuestionsPage(
    filters: questions_ops.QuestionPageFilters,
    scope: questions_ops.QuestionScope,
  ): Promise<PaginatedResult<LearningQuestion>> {
    return await questions_ops.listQuestionsPage(
      this.operationContext,
      filters,
      scope,
    );
  }

  /** Thống kê nhanh tổng câu hỏi, trắc nghiệm và tự luận theo từng khóa học trong phạm vi của người gọi. */
  async getQuestionSummary(courseId: string | undefined, scope: questions_ops.QuestionScope): Promise<QuestionSummary> {
    return await questions_ops.getQuestionSummary(
      this.operationContext,
      courseId,
      scope,
    );
  }

  /** Validate nội dung/đáp án, tạo family câu hỏi và chọn trạng thái theo chế độ duyệt cấu hình. */
  async createQuestion(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId: string,
  ): Promise<LearningQuestion> {
    return await questions_ops.createQuestion(
      this.operationContext,
      input,
      authorId,
    );
  }

  /** Tạo version kế tiếp của câu hỏi thay vì sửa bản đã dùng, đồng thời chống nội dung trùng. */
  async updateQuestion(
    questionId: string,
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId: string,
  ): Promise<LearningQuestion> {
    return await questions_ops.updateQuestion(
      this.operationContext,
      questionId,
      input,
      authorId,
    );
  }

  /** Kiểm tra ảnh thật, lưu object mới và dọn ảnh cũ khi không còn version nào tham chiếu. */
  async uploadQuestionImage(
    questionId: string,
    upload: UploadedMaterialFile,
    actorId: string,
  ): Promise<LearningQuestion> {
    return await questions_ops.uploadQuestionImage(
      this.operationContext,
      questionId,
      upload,
      actorId,
    );
  }

  /** Xóa liên kết ảnh của câu hỏi rồi dọn object nếu không còn tham chiếu. */
  async removeQuestionImage(questionId: string, actorId: string): Promise<LearningQuestion> {
    return await questions_ops.removeQuestionImage(
      this.operationContext,
      questionId,
      actorId,
    );
  }

  /** Cho người quản lý hoặc thành viên đề/lớp hợp lệ đọc ảnh câu hỏi mà không lộ object key. */
  async readQuestionImage(
    questionId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    return await questions_ops.readQuestionImage(
      this.operationContext,
      questionId,
      role,
      actorId,
    );
  }

  /** Nhập từng câu độc lập để lỗi một mục không hủy toàn bộ lô. */
  async importQuestions(
    inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
    authorId: string,
  ): Promise<QuestionImportResult[]> {
    return await questions_ops.importQuestions(
      this.operationContext,
      inputs,
      authorId,
    );
  }

  /** Liệt kê đề theo vai trò và quan hệ lớp, không trả đề ngoài phạm vi giảng dạy/ghi danh. */
  async listExams(
    role: string,
    actorId: string,
  ): Promise<LearningExam[]> {
    return await exams_ops.listExams(this.operationContext, role, actorId);
  }

  /** Phân trang đề tại database và giữ nguyên kiểm tra phạm vi lớp của người đang đăng nhập. */
  async listExamPage(role: string, actorId: string, query: ExamPageQuery): Promise<ExamPage> {
    return listExamPage(this.operationContext, role, actorId, query);
  }

  /** Ghép đề đã công bố với số lượt và thời gian để tính trạng thái khả dụng cho học viên. */
  async listLearnerExamSummaries(
    classId: string | undefined,
    learnerId: string,
  ): Promise<LearnerExamSummary[]> {
    return await exams_ops.listLearnerExamSummaries(
      this.operationContext,
      classId,
      learnerId,
    );
  }

  /** Trả câu hỏi cho học viên theo thứ tự seed nếu xáo trộn và loại dữ liệu đáp án đúng. */
  async getExamQuestions(
    examId: string,
    learnerId: string,
  ): Promise<LearningQuestion[]> {
    return await exams_ops.getExamQuestions(
      this.operationContext,
      examId,
      learnerId,
    );
  }

  /** Xác minh giảng viên phụ trách rồi trả câu hỏi theo đúng thứ tự gốc của đề. */
  async getInstructorExamPreview(
    examId: string,
    instructorId: string,
  ): Promise<LearningQuestion[]> {
    return await exams_ops.getInstructorExamPreview(
      this.operationContext,
      examId,
      instructorId,
    );
  }

  /** Trả nội dung đề cho quản lý duyệt, chỉ khi đề đang ở hàng chờ phê duyệt. */
  async getReviewerExamPreview(
    examId: string,
    actorId: string,
  ): Promise<LearningQuestion[]> {
    return await exams_ops.getReviewerExamPreview(
      this.operationContext,
      examId,
      actorId,
    );
  }

  /** Validate lịch/thang điểm/câu hỏi, giữ thứ tự chọn và tạo đề nháp cho lớp phụ trách. */
  async createExam(
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & { scoreAllocations?: Array<{ questionId: string; score: number }> },
    actorId: string,
  ): Promise<LearningExam> {
    return await exam_editing_ops.createExam(
      this.operationContext,
      input,
      actorId,
    );
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
    return await exam_editing_ops.updateExam(
      this.operationContext,
      examId,
      input,
      actorId,
    );
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
      this.operationContext,
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
      this.operationContext,
      examId,
      actorId,
      confirmQuestions,
      expectedVersion,
      forcePublish,
    );
  }

  /** Kiểm tra ghi danh, cửa sổ thi, giới hạn lượt rồi tạo hoặc tiếp tục lượt đang làm. */
  async startAttempt(
    examId: string,
    learnerId: string,
  ): Promise<ExamAttempt> {
    return await attempts_ops.startAttempt(
      this.operationContext,
      examId,
      learnerId,
    );
  }

  /** Validate đáp án thuộc đề và upsert câu trả lời khi lượt thi còn trong hạn. */
  async saveAnswer(
    attemptId: string,
    questionId: string,
    answers: string[],
    learnerId: string,
  ): Promise<ExamAttempt> {
    return await attempts_ops.saveAnswer(
      this.operationContext,
      attemptId,
      questionId,
      answers,
      learnerId,
    );
  }

  /**
   * Lưu gộp đáp án cuối cùng rồi nộp bài. Nếu đã quá hạn lưu, các đáp án gửi kèm bị bỏ qua và bài được nộp
   * với những gì máy chủ đã lưu trước hạn, giống luồng nộp tự động khi hết giờ.
   */
  async submitAttemptWithAnswers(
    attemptId: string,
    learnerId: string,
    answers: Array<{ questionId: string; answers: string[] }> = [],
  ): Promise<ExamAttempt> {
    try {
      await attempts_ops.saveAnswers(this.operationContext, attemptId, answers, learnerId);
    } catch (error) {
      if (!(error instanceof BadRequestException) || error.message !== "Đã hết thời gian lưu câu trả lời.") throw error;
    }
    return this.submitAttempt(attemptId, learnerId);
  }

  /** Chốt lượt thi nguyên tử, tự chấm câu khách quan và phát receipt chống nhầm lẫn. */
  async submitAttempt(
    attemptId: string,
    learnerId: string,
    trigger: "LEARNER" | "SYSTEM" = "LEARNER",
  ): Promise<ExamAttempt> {
    return await attempts_ops.submitAttempt(
      this.operationContext,
      attemptId,
      learnerId,
      trigger,
    );
  }

  /** Tìm lượt IN_PROGRESS quá hạn theo lô và nộp tự động bằng cùng logic submit. */
  async reconcileExpiredAttempts(limit = 100): Promise<number> {
    return await attempts_ops.reconcileExpiredAttempts(
      this.operationContext,
      limit,
    );
  }

  /** Đọc một lượt thi và ánh xạ đáp án từ Prisma hoặc kho nhớ. */
  async getAttempt(attemptId: string): Promise<ExamAttempt> {
    return await attempts_ops.getAttempt(this.operationContext, attemptId);
  }

  /** Liệt kê kết quả đã nộp/chấm của học viên cùng trạng thái phúc khảo. */
  async listLearnerResults(
    learnerId: string,
  ): Promise<LearnerResult[]> {
    return await attempts_ops.listLearnerResults(
      this.operationContext,
      learnerId,
    );
  }

  /** Trả đúng kết quả thuộc học viên, từ chối truy cập chéo lượt thi. */
  async getLearnerResult(
    attemptId: string,
    learnerId: string,
  ): Promise<LearnerResult> {
    return await attempts_ops.getLearnerResult(
      this.operationContext,
      attemptId,
      learnerId,
    );
  }

  /** Mở yêu cầu phúc khảo duy nhất cho lượt đã chấm và thông báo giảng viên. */
  async requestRegrade(
    attemptId: string,
    reason: string,
    learnerId: string,
  ): Promise<RegradeRequest> {
    return await regrades_ops.requestRegrade(
      this.operationContext,
      attemptId,
      reason,
      learnerId,
    );
  }

  /** Liệt kê hàng đợi phúc khảo trong đúng phạm vi lớp của giảng viên. */
  async listRegradeRequests(
    actorId: string,
    status?: RegradeRequest["status"],
  ): Promise<RegradeRequest[]> {
    return await regrades_ops.listRegradeRequests(
      this.operationContext,
      actorId,
      status,
    );
  }

  /** Nhả yêu cầu phúc khảo mình đang xử lý về hàng đợi. */
  async releaseRegrade(requestId: string, actorId: string): Promise<RegradeRequest> {
    return await regrades_ops.releaseRegrade(this.operationContext, requestId, actorId);
  }

  /** Nhận xử lý một yêu cầu OPEN bằng cập nhật có điều kiện để chống hai người cùng nhận. */
  async claimRegrade(
    requestId: string,
    actorId: string,
  ): Promise<RegradeRequest> {
    return await regrades_ops.claimRegrade(
      this.operationContext,
      requestId,
      actorId,
    );
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
    return await regrades_ops.resolveRegrade(
      this.operationContext,
      requestId,
      input,
      actorId,
    );
  }

  /** Liệt kê lượt thi trong phạm vi lớp giảng viên phụ trách. */
  async listAttempts(
    examId: string | undefined,
    actorId: string,
  ): Promise<ExamAttempt[]> {
    return await regrades_ops.listAttempts(
      this.operationContext,
      examId,
      actorId,
    );
  }

  /** Thu thập tối đa sáu tệp đã công khai trong các lớp cùng môn mà giảng viên được phân công. */
  async getExamGenerationContext(
    classId: string,
    actorId: string,
    rawMaterialIds: string[] = [],
    skipMaterials = false,
  ): Promise<ExamGenerationContext> {
    return await exam_generation_ops.getExamGenerationContext(
      this.operationContext,
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
      this.operationContext,
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
      this.operationContext,
      input,
      questions,
      courseId,
      generationContext,
      clientRequestId,
      actorId,
    );
  }

  /** Trả đầy đủ đề, bài làm và điểm từng câu sau khi xác minh phạm vi giảng viên. */
  async getAttemptReview(
    attemptId: string,
    actorId: string,
  ): Promise<ExamAttemptReview> {
    return await grading_ops.getAttemptReview(
      this.operationContext,
      attemptId,
      actorId,
    );
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
      this.operationContext,
      attemptId,
      score,
      feedback,
      correctionReason,
      graderId,
      questionScores,
    );
  }


  /** Liệt kê chủ đề theo lớp truy cập được, ưu tiên chủ đề ghim rồi mới theo cập nhật. */
  async listTopics(
    role: string,
    actorId: string,
  ): Promise<ForumTopic[]> {
    return await forum_ops.listTopics(this.operationContext, role, actorId);
  }

  /** Phân trang chủ đề diễn đàn trực tiếp từ DB kèm bộ lọc lớp, ghim, bài của tôi và từ khóa. */
  async listTopicsPage(
    role: string,
    actorId: string,
    filters: forum_ops.ForumTopicPageFilters = {},
  ): Promise<PaginatedResult<ForumTopic>> {
    return await forum_ops.listTopicsPage(
      this.operationContext,
      role,
      actorId,
      filters,
    );
  }

  /** Kiểm tra thành viên/chính sách nội dung rồi tạo chủ đề và thông báo thành viên lớp. */
  async createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId: string,
    authorRole = authorId === "usr-learner" ? "LEARNER" : "INSTRUCTOR",
  ): Promise<ForumTopic> {
    return await forum_ops.createTopic(
      this.operationContext,
      classId,
      input,
      authorId,
      authorRole,
    );
  }

  /** Ghim hoặc khóa chủ đề với lý do bắt buộc và ghi audit người điều phối. */
  async moderateTopic(
    topicId: string,
    input: { isLocked?: boolean; isPinned?: boolean; reason: string },
    actorId: string,
  ): Promise<ForumTopic> {
    return await forum_ops.moderateTopic(
      this.operationContext,
      topicId,
      input,
      actorId,
    );
  }

  /** Kiểm tra quyền lớp rồi trả cây bài viết, ẩn nội dung đã xóa/kiểm duyệt phù hợp. */
  async listPosts(
    topicId: string,
    role: string,
    actorId: string,
  ): Promise<ForumPost[]> {
    return await forum_ops.listPosts(
      this.operationContext,
      topicId,
      role,
      actorId,
    );
  }

  /** Phân trang bình luận gốc của chủ đề kèm đầy đủ phản hồi thuộc từng gốc đó. */
  async listPostsPage(
    topicId: string,
    role: string,
    actorId: string,
    filters: { page?: number; pageSize?: number } = {},
  ): Promise<forum_ops.ForumPostPageResult> {
    return await forum_ops.listPostsPage(
      this.operationContext,
      topicId,
      role,
      actorId,
      filters,
    );
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
    return await forum_ops.createPost(
      this.operationContext,
      topicId,
      body,
      authorId,
      parentId,
      rawAttachmentIds,
      rawMentionedUserIds,
    );
  }

  /** Cho đúng tác giả sửa bài chưa bị xóa/ẩn và chạy lại chính sách nội dung. */
  async updatePost(
    postId: string,
    body: string,
    authorId: string,
  ): Promise<ForumPost> {
    return await forum_ops.updatePost(
      this.operationContext,
      postId,
      body,
      authorId,
    );
  }

  /** Xóa mềm bài viết của tác giả để giữ tính toàn vẹn chuỗi thảo luận. */
  async deletePost(
    postId: string,
    authorId: string,
  ): Promise<ForumPost> {
    return await forum_ops.deletePost(this.operationContext, postId, authorId);
  }

  /** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất. */
  async listNotifications(
    recipientId: string,
  ): Promise<LearningNotification[]> {
    return await moderation_ops.listNotifications(
      this.operationContext,
      recipientId,
    );
  }

  /** Đánh dấu toàn bộ thông báo của người nhận là đã đọc và trả danh sách mới. */
  async markAllNotificationsRead(recipientId: string): Promise<LearningNotification[]> {
    return await moderation_ops.markAllNotificationsRead(this.operationContext, recipientId);
  }

  /** Đánh dấu đã đọc bằng điều kiện recipientId để ngăn sửa thông báo người khác. */
  async markNotificationRead(
    notificationId: string,
    recipientId: string,
  ): Promise<LearningNotification> {
    return await moderation_ops.markNotificationRead(
      this.operationContext,
      notificationId,
      recipientId,
    );
  }

  /** Liệt kê buổi trực tuyến theo quan hệ lớp và trạng thái truy cập của vai trò. */
  async listSessions(
    role: string,
    actorId: string,
  ): Promise<LiveSession[]> {
    return await live_sessions_ops.listSessions(
      this.operationContext,
      role,
      actorId,
    );
  }

  /** Phân trang buổi học trực tuyến theo lớp, trạng thái và khoảng thời gian trên DB. */
  async listSessionsPage(
    role: string,
    actorId: string,
    filters: live_sessions_ops.LiveSessionPageFilters = {},
  ): Promise<PaginatedResult<LiveSession>> {
    return await live_sessions_ops.listSessionsPage(
      this.operationContext,
      role,
      actorId,
      filters,
    );
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
    return await live_sessions_ops.createSession(
      this.operationContext,
      classId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Cập nhật lịch và liên kết phòng họp trước khi buổi học diễn ra và lưu lý do audit. */
  async updateSession(
    sessionId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      reason: string;
      meetingUrl?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.updateSession(
      this.operationContext,
      sessionId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Hủy buổi chưa hoàn tất, ghi lý do và gửi thông báo tới lớp. */
  async cancelSession(
    sessionId: string,
    reason: string,
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.cancelSession(
      this.operationContext,
      sessionId,
      reason,
      actorId,
      actorRole,
    );
  }

  /** Kiểm soát chuyển trạng thái buổi học và cập nhật mốc vận hành liên quan. */
  async transitionSession(
    sessionId: string,
    status: LiveSession["status"],
    actorId: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.transitionSession(
      this.operationContext,
      sessionId,
      status,
      actorId,
    );
  }

  /** Xác minh ghi danh/quyền lớp/cửa sổ tham dự và trả URL phòng họp hợp lệ. */
  async joinSession(
    sessionId: string,
    actorId: string,
    actorRole: string,
  ): Promise<{ attendeeUrl: string; joinedAt: string }> {
    return await live_sessions_ops.joinSession(
      this.operationContext,
      sessionId,
      actorId,
      actorRole,
    );
  }

  /** Gắn nguồn bản ghi cho buổi đã hoàn tất và chuyển sang trạng thái xử lý. */
  async attachRecording(
    sessionId: string,
    recordingUrl: string,
    actorId: string,
  ): Promise<LiveSession> {
    return await recordings_ops.attachRecording(
      this.operationContext,
      sessionId,
      recordingUrl,
      actorId,
    );
  }

  /** Chốt xử lý bản ghi, tính ngày hết hạn hoặc lưu lỗi và thông báo học viên khi sẵn sàng. */
  async completeRecording(
    sessionId: string,
    status: "READY" | "FAILED",
    retentionDays = 90,
    errorMessage: string | undefined,
    actorId: string,
  ): Promise<LiveSession> {
    return await recordings_ops.completeRecording(
      this.operationContext,
      sessionId,
      status,
      retentionDays,
      errorMessage,
      actorId,
    );
  }

  /** Kiểm tra bản ghi READY, có URL và chưa vượt thời hạn lưu giữ. */
  private isRecordingAvailable(
    session: Pick<
      LiveSession,
      "recordingUrl" | "recordingStatus" | "recordingExpiresAt"
    >,
  ): boolean {
    return recordings_ops.isRecordingAvailable(session);
  }

  /** Trả tóm tắt buổi học, trạng thái điểm danh và khả năng xem bản ghi của học viên. */
  async getSessionSummary(
    sessionId: string,
    learnerId: string,
  ): Promise<object> {
    return await recordings_ops.getSessionSummary(
      this.operationContext,
      sessionId,
      learnerId,
    );
  }

  /** Phát URL nội bộ ký theo session, learner và hạn để bảo vệ bản ghi. */
  async createRecordingAccess(
    sessionId: string,
    learnerId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return await recordings_ops.createRecordingAccess(
      this.operationContext,
      sessionId,
      learnerId,
    );
  }

  /** Xác minh chữ ký/hạn/quyền học viên rồi mới trả URL provider thực. */
  async resolveRecordingAccess(
    sessionId: string,
    expires: number,
    signature: string,
    learnerId: string,
  ): Promise<{ recordingUrl: string }> {
    return await recordings_ops.resolveRecordingAccess(
      this.operationContext,
      sessionId,
      expires,
      signature,
      learnerId,
    );
  }

  /** Liệt kê tất cả phiếu cho nhân sự hỗ trợ hoặc chỉ phiếu của người gửi. */
  async listTickets(
    role: string,
    actorId: string,
  ): Promise<SupportTicket[]> {
    return await support_ops.listTickets(this.operationContext, role, actorId);
  }

  /** Phân trang danh sách phiếu hỗ trợ theo vai trò, trạng thái và từ khóa. */
  async listTicketsPage(
    role: string,
    actorId: string,
    filters: support_ops.SupportTicketPageFilters = {},
  ): Promise<PaginatedResult<SupportTicket>> {
    return await support_ops.listTicketsPage(
      this.operationContext,
      role,
      actorId,
      filters,
    );
  }

  /** Validate nội dung, chống phiếu trùng đang mở và tạo SLA theo mức độ nghiêm trọng. */
  async createTicket(
    input: Pick<
      SupportTicket,
      "category" | "severity" | "description" | "contextId"
    > & { clientRequestId?: string },
    reporterId: string,
  ): Promise<SupportTicket> {
    return await support_ops.createTicket(
      this.operationContext,
      input,
      reporterId,
    );
  }

  /** Adapter tương thích cũ ánh xạ vai trò demo sang userId để đọc thông báo. */
  listRoleNotifications(role: string): Promise<LearningNotification[]> {
    return support_ops.listRoleNotifications(this.operationContext, role);
  }

  /** Adapter tương thích cũ đánh dấu thông báo theo userId mặc định của vai trò. */
  markRoleNotificationRead(
    notificationId: string,
    role: string,
  ): Promise<LearningNotification> {
    return support_ops.markRoleNotificationRead(
      this.operationContext,
      notificationId,
      role,
    );
  }

  /** Kiểm tra quyền phiếu, magic bytes/virus rồi lưu tệp bằng chứng và metadata. */
  async addSupportAttachment(
    ticketId: string,
    upload: UploadedMaterialFile,
    role: string,
    uploaderId: string,
  ): Promise<SupportAttachment> {
    return await support_ops.addSupportAttachment(
      this.operationContext,
      ticketId,
      upload,
      role,
      uploaderId,
    );
  }

  /** Trả bytes bằng chứng cho đúng người gửi hoặc vai trò quản lý hỗ trợ. */
  async readSupportAttachment(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    return await support_ops.readSupportAttachment(
      this.operationContext,
      ticketId,
      attachmentId,
      role,
      actorId,
    );
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
    return await support_ops.readSupportAttachmentStream(
      this.operationContext,
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
    return await support_ops.updateTicket(
      this.operationContext,
      ticketId,
      input,
      actorId,
    );
  }

  /** Cho đúng người gửi đóng phiếu chưa hoàn tất và ghi mốc đóng. */
  async closeTicketByReporter(
    ticketId: string,
    reporterId: string,
  ): Promise<SupportTicket> {
    return await support_ops.closeTicketByReporter(
      this.operationContext,
      ticketId,
      reporterId,
    );
  }

  /** Kiểm tra người gửi hoặc quyền hỗ trợ trước khi trả trao đổi của phiếu. */
  async listTicketComments(
    ticketId: string,
    role: string,
    actorId: string,
  ): Promise<TicketComment[]> {
    return await support_ops.listTicketComments(
      this.operationContext,
      ticketId,
      role,
      actorId,
    );
  }

  /** Thêm trao đổi hợp lệ vào phiếu truy cập được và cập nhật thời gian hoạt động. */
  async addTicketComment(
    ticketId: string,
    body: string,
    role: string,
    authorId: string,
  ): Promise<TicketComment> {
    return await support_ops.addTicketComment(
      this.operationContext,
      ticketId,
      body,
      role,
      authorId,
    );
  }

  /** Tổng hợp điểm danh, điểm số, hoàn thành học liệu và sinh phân loại rủi ro từng học viên. */
  async getClassProgress(
    classId: string,
    input: { from?: string; to?: string } & Partial<RiskThresholds>,
    actorId: string,
    actorRole: string,
  ): Promise<ClassProgressReport> {
    return await progress_ops.getClassProgress(
      this.operationContext,
      classId,
      input,
      actorId,
      actorRole,
    );
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
    return await progress_ops.createProgressIntervention(
      this.operationContext,
      classId,
      input,
      createdById,
      actorRole,
    );
  }

  /** Liệt kê hành động hỗ trợ đang thuộc trách nhiệm của người dùng hiện tại. */
  async listMyProgressInterventions(
    ownerId: string,
  ): Promise<ProgressIntervention[]> {
    return await progress_ops.listMyProgressInterventions(
      this.operationContext,
      ownerId,
    );
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
    return await progress_ops.updateProgressIntervention(
      this.operationContext,
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
    rawReason: string,
    actorId: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await progress_ops.transferProgressIntervention(
      this.operationContext,
      interventionId,
      assigneeId,
      rawReason,
      actorId,
      actorRole,
    );
  }

  /** Chọn Prisma khi DB được bật; nếu không các public method dùng dữ liệu nhớ demo. */
  private database(): PrismaService | undefined {
    return mapping_ops.database(this.operationContext);
  }


  /** Ánh xạ Course Prisma, bao gồm JSON outcomes, sang hợp đồng API. */
  private mapCourse(
    row: Prisma.CourseGetPayload<Record<string, never>>,
  ): LearningCourse {
    return mapping_ops.mapCourse(this.operationContext, row);
  }

  /** Ánh xạ lớp cùng thành viên hoạt động và metadata vòng đời. */
  private mapClass(row: ClassWithMembers): LearningClass {
    return mapping_ops.mapClass(row);
  }

  /** Ánh xạ học liệu và chỉ công bố metadata cần thiết, không lộ object key. */
  private mapMaterial(
    row: Prisma.MaterialGetPayload<Record<string, never>>,
  ): LearningMaterial {
    return mapping_ops.mapMaterial(this.operationContext, row);
  }

  /** Thu hẹp JSON options/answers/tags và ánh xạ version family của câu hỏi. */
  private mapQuestion(
    row: Prisma.QuestionGetPayload<Record<string, never>>,
  ): LearningQuestion {
    return mapping_ops.mapQuestion(this.operationContext, row);
  }

  /** Phân tích phân bố điểm, tỷ lệ hoàn thành và hiệu suất câu hỏi trong phạm vi giảng viên. */
  async getExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId: string,
  ): Promise<ExamAnalytics> {
    return await analytics_ops.getExamAnalytics(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Chuyển dữ liệu phân tích đề thi sang CSV có BOM để Excel đọc Unicode đúng. */
  async exportExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId: string,
  ): Promise<Buffer> {
    return await analytics_ops.exportExamAnalytics(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Sao chép sâu các mảng câu hỏi in-memory để caller không sửa state nội bộ. */
  private cloneQuestion(item: LearningQuestion): LearningQuestion {
    return question_rules_ops.cloneQuestion(item);
  }

  /** Chọn version cao nhất trong mỗi family câu hỏi. */
  private latestQuestionVersions(
    items: LearningQuestion[],
  ): LearningQuestion[] {
    return question_rules_ops.latestQuestionVersions(items);
  }

  /** Chỉ tái dùng câu ngân hàng khi nội dung, loại, lựa chọn, đáp án và độ khó khớp hoàn toàn. */
  private sameGeneratedQuestion(
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
  ): boolean {
    return question_rules_ops.sameGeneratedQuestion(existing, generated);
  }

  /** Chuẩn hóa nội dung rồi băm để phát hiện câu hỏi trùng. */
  private questionContentHash(content: string): string {
    return question_rules_ops.questionContentHash(content);
  }

  /** Chuẩn hóa rich text/đáp án/tag và kiểm tra quy tắc riêng cho từng loại câu hỏi. */
  private validateQuestionInput(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
  ): Omit<
    LearningQuestion,
    "id" | "status" | "version" | "familyId" | "supersedesId"
  > {
    return question_rules_ops.validateQuestionInput(input);
  }

  /** Chuẩn hóa đáp án nộp và chặn lựa chọn không thuộc options của câu hỏi. */
  private validateSubmittedAnswers(
    question: LearningQuestion,
    answers: string[],
  ): string[] {
    return question_rules_ops.validateSubmittedAnswers(question, answers);
  }

  /** So sánh đáp án khách quan không phụ thuộc thứ tự lựa chọn. */
  private isQuestionAnswerCorrect(
    question: LearningQuestion,
    submitted: string[],
  ): boolean {
    return question_rules_ops.isQuestionAnswerCorrect(question, submitted);
  }

  /** Ánh xạ đề và giữ thứ tự câu hỏi theo trường order trong bảng nối. */
  private mapExam(row: ExamWithQuestions): LearningExam {
    return result_mapping_ops.mapExam(row);
  }

  /** Ánh xạ lượt thi cùng câu trả lời và receipt sang hợp đồng API. */
  private mapAttempt(row: AttemptWithAnswers): ExamAttempt {
    return result_mapping_ops.mapAttempt(this.operationContext, row);
  }

  /** Tạo mã biên nhận HMAC bằng khóa bí mật máy chủ; chế độ bộ nhớ dùng khóa ngẫu nhiên theo tiến trình. */
  private submissionReceipt(attempt: { id: string; examId: string; learnerId: string }, submittedAt: string): string {
    return result_mapping_ops.submissionReceipt(attempt, submittedAt, this.config?.get("AUTH_ENCRYPTION_SECRET", { infer: true }) || this.receiptFallbackSecret);
  }

  /** Ánh xạ yêu cầu phúc khảo và các mốc xử lý. */
  private mapRegradeRequest(
    row: Prisma.RegradeRequestGetPayload<Record<string, never>>,
  ): RegradeRequest {
    return result_mapping_ops.mapRegradeRequest(row);
  }

  /** Ánh xạ chủ đề diễn đàn và trạng thái điều phối. */
  private mapTopic(
    row: Prisma.ForumTopicGetPayload<Record<string, never>>,
  ): ForumTopic {
    return engagement_mapping_ops.mapTopic(this.operationContext, row);
  }

  /** Ánh xạ bài viết, mentions và tệp đính kèm nếu relation đã được include. */
  private mapPost(
    row:
      | Prisma.ForumPostGetPayload<Record<string, never>>
      | ForumPostWithRelations,
  ): ForumPost {
    return engagement_mapping_ops.mapPost(row);
  }

  /** Ánh xạ biện pháp can thiệp tiến độ sang kiểu ngày ISO. */
  private mapProgressIntervention(
    row: Prisma.ProgressInterventionGetPayload<Record<string, never>>,
  ): ProgressIntervention {
    return engagement_mapping_ops.mapProgressIntervention(
      this.operationContext,
      row,
    );
  }

  /** Chuẩn hóa lịch sử bàn giao JSON trước khi đưa ra API hoặc ghi nối tiếp. */
  private progressInterventionHistory(
    value: Prisma.JsonValue,
  ): ProgressIntervention["history"] {
    return engagement_mapping_ops.progressInterventionHistory(value);
  }

  /** Parse khoảng báo cáo, áp dụng mặc định và từ chối ngày đảo ngược/không hợp lệ. */
  private reportingPeriod(
    fromInput?: string,
    toInput?: string,
  ): { from: Date; to: Date } {
    return report_rules_ops.reportingPeriod(fromInput, toInput);
  }

  /** Bảo đảm các ngưỡng rủi ro nằm trong miền phần trăm hợp lệ. */
  private validateRiskThresholds(thresholds: RiskThresholds): void {
    return report_rules_ops.validateRiskThresholds(thresholds);
  }

  /** Dùng Intl kiểm tra tên múi giờ IANA trước khi lưu lớp. */
  private validateTimezone(timezone: string): void {
    return report_rules_ops.validateTimezone(timezone);
  }

  /** Tính phần trăm làm tròn và tránh chia cho zero. */
  private percentage(numerator: number, denominator: number): number {
    return report_rules_ops.percentage(numerator, denominator);
  }

  /** Trả mốc ISO mới nhất hoặc undefined khi không có dữ liệu. */
  private latestDate(values: Date[]): string | undefined {
    return report_rules_ops.latestDate(values);
  }

  /** So sánh chỉ số học viên với ngưỡng để sinh mức và lý do rủi ro. */
  private buildLearnerProgress(
    input: Omit<LearnerProgress, "riskLevel" | "riskReasons"> & {
      thresholds: RiskThresholds; scoredItems?: number; totalAssessments?: number;
    },
  ): LearnerProgress {
    return report_rules_ops.buildLearnerProgress(input);
  }

  /** Dựng URL chủ phòng/người học cho provider demo bằng token phòng ngẫu nhiên. */
  private buildProviderUrls(
    provider: LiveSession["provider"],
    token: string,
  ): { hostUrl: string; attendeeUrl: string } {
    return providers_ops.buildProviderUrls(provider, token);
  }

  /** Xáo trộn xác định theo seed để một học viên nhận thứ tự ổn định trong lượt thi. */
  private seededOrder(values: string[], seed: string): string[] {
    return providers_ops.seededOrder(values, seed);
  }

  /** Chuẩn hóa phân bổ điểm từng câu, đối chiếu đủ câu và tổng điểm với sai số hai chữ số thập phân. */
  private resolveExamScoreAllocations(
    questionIds: string[],
    totalScore: number,
    allocations?: Array<{ questionId: string; score: number }>,
  ): Record<string, number> {
    return providers_ops.resolveExamScoreAllocations(
      questionIds,
      totalScore,
      allocations,
    );
  }

  /** Lấy thang điểm một câu trong fallback in-memory, hỗ trợ dữ liệu cũ chia đều. */
  private examQuestionScore(exam: LearningExam, questionId: string): number {
    return providers_ops.examQuestionScore(exam, questionId);
  }

  /** Thử cấp phòng provider yêu cầu và chuyển sang fallback khi provider không khả dụng. */
  private async provisionProviderMeeting(
    requested: LiveSession["provider"],
  ): Promise<{
    provider: LiveSession["provider"];
    hostUrl: string;
    attendeeUrl: string;
    fallbackUsed: boolean;
    attempts: number;
  }> {
    return await providers_ops.provisionProviderMeeting(
      this.operationContext,
      requested,
    );
  }

  /** Truy vấn danh sách userId đang có một vai trò cụ thể để phát thông báo. */
  private async userIdsForRole(
    database: PrismaService | Prisma.TransactionClient,
    roleCode: string,
  ): Promise<string[]> {
    return await providers_ops.userIdsForRole(database, roleCode);
  }

  /** Tạo notification hàng loạt cho giảng viên và học viên hoạt động của lớp. */
  private async notifyClassMembers(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
    type: string,
    title: string,
    entityId: string,
    templateEventCode?: string,
    templateVariables: Record<string, string> = {},
  ): Promise<void> {
    return await providers_ops.notifyClassMembers(
      this.operationContext,
      database,
      classId,
      type,
      title,
      entityId,
      templateEventCode,
      templateVariables,
    );
  }

  /** Ánh xạ buổi học trực tuyến và metadata provider/recording sang API. */
  private mapSession(
    row: Prisma.LiveSessionGetPayload<Record<string, never>>,
  ): LiveSession {
    return session_mapping_ops.mapSession(this.operationContext, row);
  }

  /** Ánh xạ phiếu hỗ trợ và tệp đính kèm khi relation đã được tải. */
  private mapTicket(
    row:
      | Prisma.SupportTicketGetPayload<Record<string, never>>
      | SupportTicketWithAttachments,
  ): SupportTicket {
    return session_mapping_ops.mapTicket(row);
  }

  /** Type guard giới hạn provider vào danh mục phòng họp được hỗ trợ. */
  private isLiveProvider(value: string): value is LiveSession["provider"] {
    return providers_ops.isLiveProvider(value);
  }

  /** Chuyển các bộ đếm nghiệp vụ còn mở thành danh sách blocker đóng lớp. */
  private buildClassClosureReadiness(
    status: LearningClass["status"],
    endAt: Date,
    counts: Omit<ClassClosureReadiness, "eligible" | "blockers">,
  ): ClassClosureReadiness {
    return class_rules_ops.buildClassClosureReadiness(status, endAt, counts);
  }

  /** Tải lớp cùng thành viên và ném 404 nhất quán nếu không tồn tại. */
  private async getDatabaseClass(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
  ): Promise<LearningClass> {
    return await class_rules_ops.getDatabaseClass(
      this.operationContext,
      database,
      classId,
    );
  }

  /** Tải đề cùng câu hỏi theo thứ tự để dùng chung giữa các luồng thi. */
  private async getDatabaseExam(
    database: PrismaService | Prisma.TransactionClient,
    examId: string,
  ): Promise<LearningExam> {
    return await class_rules_ops.getDatabaseExam(
      this.operationContext,
      database,
      examId,
    );
  }

  /** Tải lượt thi cùng đáp án và ném 404 nhất quán. */
  private async getDatabaseAttempt(
    database: PrismaService | Prisma.TransactionClient,
    attemptId: string,
  ): Promise<ExamAttempt> {
    return await class_rules_ops.getDatabaseAttempt(
      this.operationContext,
      database,
      attemptId,
    );
  }

  /** Bắt buộc user tồn tại, đang hoạt động hoặc vừa được cấp, và có vai trò yêu cầu trước mutation thành viên. */
  private async requireUserRole(
    database: PrismaService,
    userId: string,
    roleCode: "INSTRUCTOR" | "LEARNER",
    message: string,
  ): Promise<void> {
    return await class_rules_ops.requireUserRole(
      database,
      userId,
      roleCode,
      message,
    );
  }

  /** Đọc chính sách storage từ cấu hình hệ thống và áp dụng mặc định an toàn. */
  private async getStoragePolicy(database: PrismaService): Promise<{
    maxFileSizeMb: number;
    storageQuotaMb: number;
    allowedMimeTypes: string[];
  }> {
    return await storage_ops.getStoragePolicy(database);
  }

  /** Cung cấp giới hạn tệp hiện hành cho trình chọn học liệu của giảng viên. */
  async getMaterialUploadPolicy(): Promise<{ maxFileSizeMb: number; allowedMimeTypes: string[] }> {
    const policy = this.prisma
      ? await this.getStoragePolicy(this.prisma)
      : { maxFileSizeMb: 50, allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES] };
    return { maxFileSizeMb: policy.maxFileSizeMb, allowedMimeTypes: policy.allowedMimeTypes };
  }

  /** Kiểm tra quota/chính sách, quét virus rồi ghi upload vào namespace material/quarantine. */
  private async storeUpload(
    classId: string,
    materialId: string,
    upload: UploadedMaterialFile,
    quarantined = false,
  ): Promise<{ objectKey: string; checksum: string }> {
    return await storage_ops.storeUpload(
      this.operationContext,
      classId,
      materialId,
      upload,
      quarantined,
    );
  }

  /** Ghi object qua storage service hoặc filesystem fallback đã chặn path traversal. */
  private async writeStoredFile(
    objectKey: string,
    buffer: Buffer,
  ): Promise<StoredObject> {
    return await storage_ops.writeStoredFile(
      this.operationContext,
      objectKey,
      buffer,
    );
  }

  /** Xóa object theo best-effort ở provider chính hoặc filesystem fallback. */
  private async removeStoredFile(objectKey: string): Promise<void> {
    return await storage_ops.removeStoredFile(this.operationContext, objectKey);
  }

  /** Chỉ xóa ảnh câu hỏi khi không còn version nào tham chiếu cùng object key. */
  private async removeQuestionObjectIfUnreferenced(
    objectKey: string,
  ): Promise<void> {
    return await storage_ops.removeQuestionObjectIfUnreferenced(
      this.operationContext,
      objectKey,
    );
  }

  /** Resolve đường dẫn fallback và từ chối object key thoát khỏi storage root. */
  private resolveObjectPath(objectKey: string): string {
    return storage_ops.resolveObjectPath(this.operationContext, objectKey);
  }

  /** Ký HMAC liên kết học liệu, ràng buộc id, hạn và loại hành động. */
  private signMaterialAccess(
    materialId: string,
    expires: number,
    action: MaterialAccessAction,
  ): string {
    return storage_ops.signMaterialAccess(
      this.operationContext,
      materialId,
      expires,
      action,
    );
  }

  /** Ký liên kết bản ghi gắn riêng với buổi học và học viên. */
  private signRecordingAccess(
    sessionId: string,
    expires: number,
    learnerId: string,
  ): string {
    return storage_ops.signRecordingAccess(
      this.operationContext,
      sessionId,
      expires,
      learnerId,
    );
  }

  /** Kiểm tra hạn và so sánh chữ ký constant-time, trả thông báo nghiệp vụ tương ứng. */
  private verifyExpiringSignature(
    expectedSignature: string,
    expires: number,
    signature: string,
    message: string,
  ): void {
    return storage_ops.verifyExpiringSignature(
      expectedSignature,
      expires,
      signature,
      message,
    );
  }

  /** Dựng lại chữ ký học liệu mong đợi và dùng bộ kiểm tra liên kết hết hạn. */
  private verifyMaterialAccess(
    materialId: string,
    expires: number,
    signature: string,
    action: MaterialAccessAction,
  ): void {
    return storage_ops.verifyMaterialAccess(
      this.operationContext,
      materialId,
      expires,
      signature,
      action,
    );
  }

  /** Ánh xạ vai trò sang tài khoản seed tương ứng chỉ cho fallback/demo. */
  private userIdForRole(role: string): string {
    return access_ops.userIdForRole(role);
  }

  /** Đọc object qua storage service hoặc filesystem fallback. */
  private readStoredFile(objectKey: string): Promise<Buffer> {
    return access_ops.readStoredFile(this.operationContext, objectKey);
  }

  /** Xác định object key thuộc namespace học liệu mà service cho phép phục vụ. */
  private isMaterialObjectKey(objectKey: string): boolean {
    return access_ops.isMaterialObjectKey(objectKey);
  }

  /** Cho phép vai trò quản trị/điều hành truy cập hàng đợi hỗ trợ. */
  private canManageSupport(role: string): boolean {
    return access_ops.canManageSupport(role);
  }

  /** Áp dụng quyền lớp và visibility cho học liệu fallback in-memory. */
  private canAccessMemoryMaterial(
    material: LearningMaterial,
    role: string,
    actorId: string,
  ): boolean {
    return access_ops.canAccessMemoryMaterial(
      this.operationContext,
      material,
      role,
      actorId,
    );
  }



  /** Tính trạng thái đề từ công bố, cửa sổ thời gian, lượt đang làm và giới hạn số lượt. */
  private examAvailability(
    exam: LearningExam,
    attemptCount: number,
    active: boolean,
    timestamp: Date,
  ): LearnerExamSummary["availabilityStatus"] {
    return access_ops.examAvailability(exam, attemptCount, active, timestamp);
  }

  /** Chọn hạn sớm hơn giữa thời lượng lượt thi và giờ đóng đề. */
  private attemptDeadline(
    startedAt: Date,
    durationMinutes: number,
    examCloseAt: Date,
  ): Date {
    return access_ops.attemptDeadline(startedAt, durationMinutes, examCloseAt);
  }

  /** Tìm câu hỏi fallback và dùng chung logic so sánh đáp án khách quan. */
  private isMemoryAnswerCorrect(
    questionId: string,
    submitted: string[],
  ): boolean {
    return access_ops.isMemoryAnswerCorrect(
      this.operationContext,
      questionId,
      submitted,
    );
  }

  /** Chuẩn hóa văn bản diễn đàn và áp dụng giới hạn độ dài/nội dung rỗng. */
  private validateForumContent(value: string, label: string): string {
    return content_rules_ops.validateForumContent(value, label);
  }

  /** Chuẩn hóa văn bản phiếu hỗ trợ và chặn nội dung rỗng/quá dài. */
  private validateSupportText(value: string, label: string): string {
    return content_rules_ops.validateSupportText(
      this.operationContext,
      value,
      label,
    );
  }

  /** Kiểm tra kích thước, MIME và chữ ký tệp bằng chứng hỗ trợ. */
  private validateSupportUpload(upload: UploadedMaterialFile): void {
    return content_rules_ops.validateSupportUpload(
      this.operationContext,
      upload,
    );
  }

  /** Phát hiện mẫu tệp thực thi/script nguy hiểm khi antivirus ngoài không khả dụng. */
  private detectMaliciousUpload(
    upload: UploadedMaterialFile,
  ): string | undefined {
    return file_rules_ops.detectMaliciousUpload(upload);
  }

  /** Kiểm tra giới hạn, MIME, magic bytes và quét virus cho ảnh câu hỏi. */
  private async validateQuestionImage(
    upload: UploadedMaterialFile,
  ): Promise<void> {
    return await file_rules_ops.validateQuestionImage(
      this.operationContext,
      upload,
    );
  }

  /** Gọi antivirus service và trả lý do cách ly thay vì ném lỗi khi phát hiện malware. */
  private async scanUpload(
    upload: UploadedMaterialFile,
  ): Promise<string | undefined> {
    return await file_rules_ops.scanUpload(this.operationContext, upload);
  }

  /** Xác minh vai trò quản trị hoặc thành viên lớp trước thao tác diễn đàn Prisma. */
  private assertForumClassAccess(
    classItem: ClassWithMembers,
    role: string,
    actorId: string,
  ): void {
    return forum_rules_ops.assertForumClassAccess(classItem, role, actorId);
  }

  /** Xác minh quyền diễn đàn tương đương trên dữ liệu lớp in-memory. */
  private assertMemoryForumClassAccess(
    classId: string,
    role: string,
    actorId: string,
  ): void {
    return forum_rules_ops.assertMemoryForumClassAccess(
      this.operationContext,
      classId,
      role,
      actorId,
    );
  }

  /** Thu hẹp JSON thành mảng chuỗi, loại mọi phần tử không đúng kiểu. */
  private toStringArray(value: Prisma.JsonValue): string[] {
    return lookups_ops.toStringArray(value);
  }

  /** Tìm khóa học trong fallback và chuẩn hóa lỗi 404. */
  private findCourse(courseId: string): LearningCourse {
    return lookups_ops.findCourse(this.operationContext, courseId);
  }

  /** Tìm lớp trong fallback và chuẩn hóa lỗi 404. */
  private findClass(classId: string): LearningClass {
    return lookups_ops.findClass(this.operationContext, classId);
  }

  /** Tìm đề thi trong fallback và chuẩn hóa lỗi 404. */
  private findExam(examId: string): LearningExam {
    return lookups_ops.findExam(this.operationContext, examId);
  }

  /** Tìm lượt thi trong fallback và chuẩn hóa lỗi 404. */
  private findAttempt(attemptId: string): ExamAttempt {
    return lookups_ops.findAttempt(this.operationContext, attemptId);
  }

  /** Tìm chủ đề trong fallback và chuẩn hóa lỗi 404. */
  private findTopic(topicId: string): ForumTopic {
    return lookups_ops.findTopic(this.operationContext, topicId);
  }

  /** Tìm bài viết trong fallback và chuẩn hóa lỗi 404. */
  private findPost(postId: string): ForumPost {
    return lookups_ops.findPost(this.operationContext, postId);
  }

  /** Tìm buổi học trong fallback và chuẩn hóa lỗi 404. */
  private findSession(sessionId: string): LiveSession {
    return lookups_ops.findSession(this.operationContext, sessionId);
  }
}
