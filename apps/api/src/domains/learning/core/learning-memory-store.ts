import { now, type MemoryQuestionImage } from "./learning.shared.js";
import type {
  CourseVersionSnapshot,
  ExamAttempt,
  ForumPost,
  ForumTopic,
  InstructorRole,
  LearningClass,
  LearningCourse,
  LearningExam,
  LearningMaterial,
  LearningNotification,
  LearningQuestion,
  LiveSession,
  ProgressIntervention,
  RegradeRequest,
  SupportTicket,
  TicketComment,
} from "./learning.types.js";

/** Trạng thái bộ nhớ cục bộ dùng riêng cho ranh giới kiểm thử không cần PostgreSQL. */
export interface LearningMemoryState {
  courses: LearningCourse[];
  courseVersions: CourseVersionSnapshot[];
  classes: LearningClass[];
  folderRegistry: Map<string, Set<string>>;
  materials: LearningMaterial[];
  questions: LearningQuestion[];
  questionImages: Map<string, MemoryQuestionImage>;
  exams: LearningExam[];
  attempts: ExamAttempt[];
  regradeRequests: RegradeRequest[];
  topics: ForumTopic[];
  posts: ForumPost[];
  notifications: LearningNotification[];
  sessions: LiveSession[];
  tickets: SupportTicket[];
  ticketComments: TicketComment[];
  supportAttachmentFiles: Map<string, string>;
  materialFiles: Map<string, { objectKey: string; checksum: string }>;
  progressInterventions: ProgressIntervention[];
  instructorRoles: Map<string, InstructorRole>;
}

/** Tạo trạng thái bộ nhớ rỗng khi ứng dụng chạy với PostgreSQL thật, tránh cấp phát fixture demo thừa trong production. */
export function createEmptyLearningMemoryState(): LearningMemoryState {
  return {
    courses: [],
    courseVersions: [],
    classes: [],
    folderRegistry: new Map(),
    materials: [],
    questions: [],
    questionImages: new Map(),
    exams: [],
    attempts: [],
    regradeRequests: [],
    topics: [],
    posts: [],
    notifications: [],
    sessions: [],
    tickets: [],
    ticketComments: [],
    supportAttachmentFiles: new Map(),
    materialFiles: new Map(),
    progressInterventions: [],
    instructorRoles: new Map(),
  };
}

/** Tạo bộ fixture bộ nhớ độc lập cho unit test miền đào tạo không phụ thuộc kết nối DB. */
export function createDefaultLearningMemoryState(): LearningMemoryState {
  return {
    courses: [
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
    ],
    courseVersions: [
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
    ],
    classes: [
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
        status: "ACTIVE",
        instructorIds: ["usr-instructor"],
        learnerIds: ["usr-learner"],
      },
    ],
    folderRegistry: new Map<string, Set<string>>([
      [
        JSON.stringify(["class-web-01", "materials"]),
        new Set(["Tài liệu chung", "Tài liệu", "Bài tập tự luận", "Tuần 1", "Tuần 2"]),
      ],
      [
        JSON.stringify(["class-web-01", "lectures"]),
        new Set(["Bài giảng chung", "Bài giảng"]),
      ],
    ]),
    materials: [
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
    ],
    questions: [
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
    ],
    questionImages: new Map(),
    exams: [
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
    ],
    attempts: [],
    regradeRequests: [],
    topics: [
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
    ],
    posts: [
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
    ],
    notifications: [],
    sessions: [
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
    ],
    tickets: [],
    ticketComments: [],
    supportAttachmentFiles: new Map(),
    materialFiles: new Map(),
    progressInterventions: [],
    instructorRoles: new Map<string, InstructorRole>([
      ["class-web-01:usr-instructor", "PRIMARY"],
    ]),
  };
}
