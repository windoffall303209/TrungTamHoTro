import { createHash, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { buildDatabaseUrl } from "../src/config/database-connection.js";
import { seedDemoData } from "./demo-data.mjs";

config({ path: new URL("../../../.env", import.meta.url) });

const defaultPassword = process.env.SEED_DEFAULT_PASSWORD;
if (!defaultPassword || defaultPassword.length < 12) throw new Error("SEED_DEFAULT_PASSWORD phải có ít nhất 12 ký tự.");

const adapter = new PrismaPg({ connectionString: buildDatabaseUrl(process.env), max: 4 });
const prisma = new PrismaClient({ adapter });
const seedPasswordSalt = "wind-edu-seed-v1";
const passwordHash = `scrypt:${seedPasswordSalt}:${scryptSync(defaultPassword, seedPasswordSalt, 64).toString("hex")}`;
/** Chuẩn hóa nội dung rồi tạo mã băm để nhận diện câu hỏi mẫu trùng nhau. */
const questionHash = (content) => createHash("sha256").update(content.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex");

const permissions = ["user:view", "user:create", "user:update", "user:suspend", "role:view", "role:update", "course:view", "course:manage", "class:view", "class:manage", "material:view", "material:manage", "question:view", "question:manage", "exam:view", "exam:manage", "forum:view", "forum:post", "forum:moderate", "session:view", "session:manage", "report:view", "support:create", "support:manage", "system:configure"];
const roleMatrix = {
  SYSTEM_ADMIN: permissions,
  CENTER_MANAGER: ["user:view", "user:create", "course:view", "course:manage", "class:view", "class:manage", "material:view", "exam:view", "forum:view", "forum:moderate", "session:view", "report:view", "support:manage"],
  INSTRUCTOR: ["course:view", "class:view", "material:view", "material:manage", "question:view", "question:manage", "exam:view", "exam:manage", "forum:view", "forum:post", "forum:moderate", "session:view", "session:manage", "report:view", "support:create"],
  LEARNER: ["course:view", "class:view", "material:view", "exam:view", "forum:view", "forum:post", "session:view", "support:create"],
};
const roleNames = { SYSTEM_ADMIN: "Quản trị hệ thống", CENTER_MANAGER: "Quản lý trung tâm", INSTRUCTOR: "Giảng viên", LEARNER: "Học viên" };

/** Khởi tạo quyền, vai trò, tài khoản và dữ liệu nền trong cơ sở dữ liệu đã cấu hình. */
async function seed() {
  for (const code of permissions) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: `Quyền ${code}` } });
  for (const [code, name] of Object.entries(roleNames)) {
    const role = await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name, description: `Vai trò ${name}` } });
    const permissionRows = await prisma.permission.findMany({ where: { code: { in: roleMatrix[code] } }, select: { id: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: permissionRows.map(({ id }) => ({ roleId: role.id, permissionId: id })) });
  }
  const users = [
    { id: "usr-admin", username: "admin@wind.edu.vn", email: "admin@wind.edu.vn", displayName: "Wind Of Fall", role: "SYSTEM_ADMIN" },
    { id: "usr-manager", username: "manager@wind.edu.vn", email: "manager@wind.edu.vn", displayName: "Nguyễn Minh Anh", role: "CENTER_MANAGER" },
    { id: "usr-instructor", username: "instructor@wind.edu.vn", email: "instructor@wind.edu.vn", displayName: "Trần Thu Hà", role: "INSTRUCTOR" },
    { id: "usr-learner", username: "learner@wind.edu.vn", email: "learner@wind.edu.vn", displayName: "Lê Hoàng Nam", role: "LEARNER" },
  ];
  for (const input of users) {
    const user = await prisma.user.upsert({ where: { email: input.email }, update: { username: input.username, displayName: input.displayName, status: "ACTIVE", emailVerifiedAt: new Date(), passwordHash }, create: { id: input.id, username: input.username, email: input.email, displayName: input.displayName, emailVerifiedAt: new Date(), passwordHash } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: input.role } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  }
  const course = await prisma.course.upsert({ where: { code: "WEB-FULLSTACK" }, update: { status: "PUBLISHED" }, create: { id: "course-web", code: "WEB-FULLSTACK", name: "Phát triển Web Full-stack", description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.", outcomes: ["Thiết kế giao diện responsive", "Xây dựng REST API", "Thiết kế cơ sở dữ liệu"], status: "PUBLISHED", ownerId: "usr-manager" } });
  await prisma.course.upsert({ where: { code: "DATA-FOUNDATION" }, update: {}, create: { id: "course-data", code: "DATA-FOUNDATION", name: "Nền tảng dữ liệu", description: "Tổ chức, phân tích và trực quan hóa dữ liệu.", outcomes: ["Làm sạch dữ liệu", "Mô hình hóa dữ liệu"], status: "DRAFT", ownerId: "usr-manager" } });
  const learningClass = await prisma.learningClass.upsert({ where: { code_term: { code: "WEB-K01", term: "2026-HK1" } }, update: { status: "ACTIVE" }, create: { id: "class-web-01", courseId: course.id, courseVersion: 1, code: "WEB-K01", name: "Web Full-stack K01", term: "2026-HK1", startAt: new Date("2026-08-18T01:00:00.000Z"), endAt: new Date("2026-12-20T10:00:00.000Z"), capacity: 40, status: "ACTIVE" } });
  await prisma.classInstructor.upsert({ where: { classId_instructorId: { classId: learningClass.id, instructorId: "usr-instructor" } }, update: {}, create: { classId: learningClass.id, instructorId: "usr-instructor" } });
  await prisma.classEnrollment.upsert({ where: { classId_learnerId: { classId: learningClass.id, learnerId: "usr-learner" } }, update: { status: "ACTIVE" }, create: { classId: learningClass.id, learnerId: "usr-learner", status: "ACTIVE" } });
  const seededMaterials = [
    await prisma.material.upsert({ where: { objectKey: "seed/web/architecture.pdf" }, update: {}, create: { id: "mat-web-intro", classId: learningClass.id, courseId: learningClass.courseId, ownerId: "usr-instructor", name: "01 — Tổng quan kiến trúc Web.pdf", objectKey: "seed/web/architecture.pdf", mimeType: "application/pdf", sizeBytes: 2420000n, checksum: "sha256:seed-architecture", folder: "Tuần 1", tags: ["kiến trúc", "bắt đầu"], visibility: "PUBLISHED" } }),
    await prisma.material.upsert({ where: { objectKey: "seed/web/rest-api.pdf" }, update: {}, create: { id: "mat-api-guide", classId: learningClass.id, courseId: learningClass.courseId, ownerId: "usr-instructor", name: "02 — Thiết kế REST API.pdf", objectKey: "seed/web/rest-api.pdf", mimeType: "application/pdf", sizeBytes: 3180000n, checksum: "sha256:seed-rest-api", folder: "Tuần 2", tags: ["api", "backend"], visibility: "PUBLISHED", version: 2 } }),
  ];
  for (const material of seededMaterials) await prisma.materialVersion.upsert({ where: { materialId_version: { materialId: material.id, version: material.version } }, update: {}, create: { id: `material-version-${material.id}-${material.version}`, materialId: material.id, version: material.version, name: material.name, objectKey: material.objectKey, mimeType: material.mimeType, sizeBytes: material.sizeBytes, checksum: material.checksum, folder: material.folder, tags: material.tags, visibility: material.visibility, createdBy: material.ownerId } });
  const questionOne = await prisma.question.upsert({ where: { id: "q-rest-01" }, update: {}, create: { id: "q-rest-01", familyId: "q-rest-01", contentHash: questionHash("HTTP method nào phù hợp để cập nhật một phần tài nguyên?"), courseId: course.id, authorId: "usr-instructor", type: "SINGLE_CHOICE", content: "HTTP method nào phù hợp để cập nhật một phần tài nguyên?", options: ["GET", "POST", "PATCH", "DELETE"], correctAnswers: ["PATCH"], difficulty: 1, tags: ["http", "api"], status: "PUBLISHED" } });
  const questionTwo = await prisma.question.upsert({ where: { id: "q-db-01" }, update: {}, create: { id: "q-db-01", familyId: "q-db-01", contentHash: questionHash("Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu."), courseId: course.id, authorId: "usr-instructor", type: "TRUE_FALSE", content: "Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu.", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["database"], status: "PUBLISHED" } });
  const exam = await prisma.exam.upsert({ where: { id: "exam-mid-web" }, update: {}, create: { id: "exam-mid-web", classId: learningClass.id, title: "Kiểm tra giữa kỳ Web Full-stack", durationMinutes: 45, totalScore: 10, openAt: new Date("2026-08-20T00:00:00.000Z"), closeAt: new Date("2026-12-30T23:59:00.000Z"), attemptLimit: 2, status: "PUBLISHED" } });
  for (const [position, question] of [questionOne, questionTwo].entries()) await prisma.examQuestion.upsert({ where: { examId_questionId: { examId: exam.id, questionId: question.id } }, update: { position: position + 1 }, create: { examId: exam.id, questionId: question.id, position: position + 1, score: 5 } });
  const topic = await prisma.forumTopic.upsert({ where: { id: "topic-rest" }, update: {}, create: { id: "topic-rest", classId: learningClass.id, authorId: "usr-instructor", title: "Thảo luận: REST hay GraphQL?", body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.", tags: ["api", "thảo luận"], isPinned: true } });
  await prisma.forumPost.upsert({ where: { id: "post-rest-01" }, update: {}, create: { id: "post-rest-01", topicId: topic.id, authorId: "usr-learner", body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.", status: "PUBLISHED" } });
  await prisma.liveSession.upsert({ where: { id: "session-web-01" }, update: {}, create: { id: "session-web-01", classId: learningClass.id, hostId: "usr-instructor", title: "Thiết kế API có version", startsAt: new Date("2026-08-26T02:00:00.000Z"), endsAt: new Date("2026-08-26T03:30:00.000Z"), provider: "JITSI", requestedProvider: "JITSI", hostUrl: "https://meet.jit.si/wind-web-01-host", attendeeUrl: "https://meet.jit.si/wind-web-01", status: "SCHEDULED" } });
  await prisma.systemSetting.upsert({ where: { key: "platform" }, update: {}, create: { key: "platform", value: { centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU", timezone: "Asia/Bangkok", locale: "vi-VN", retentionDays: 365, maxFileSizeMb: 50, storageQuotaMb: 10240, allowedMimeTypes: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "video/mp4", "image/png", "image/jpeg"], moderationEnabled: true, notificationSender: "Wind EDU", maintenanceMode: false, learnerEmailNotificationsEnabled: false }, updatedBy: "usr-admin" } });
  for (const [index, provider] of ["GOOGLE_MEET", "ZOOM", "JITSI"].entries()) await prisma.integrationProvider.upsert({ where: { provider }, update: {}, create: { id: `int-${index + 1}`, provider, enabled: provider !== "ZOOM", credentialRef: provider === "JITSI" ? null : `secret://${provider.toLowerCase()}` } });
  await prisma.notificationTemplate.upsert({ where: { eventCode_locale_version: { eventCode: "CLASS_REMINDER", locale: "vi-VN", version: 1 } }, update: {}, create: { id: "tpl-class-reminder", eventCode: "CLASS_REMINDER", locale: "vi-VN", subject: "Nhắc lịch học {{className}}", body: "Buổi học {{sessionTitle}} bắt đầu lúc {{startsAt}}.", version: 1, status: "PUBLISHED" } });
  await prisma.moderationPolicy.upsert({ where: { version: 1 }, update: {}, create: { id: "policy-initial", version: 1, prohibitedTerms: ["spam", "lừa đảo"], maxPostsPerMinute: 5, action: "FLAG", publishedBy: "usr-admin" } });
  await prisma.backupJob.upsert({ where: { id: "backup-seed" }, update: {}, create: { id: "backup-seed", type: "FULL", status: "COMPLETED", checksum: "sha256:9e151f", sizeBytes: 18400000n, completedAt: new Date() } });
  const baselineAudit = await prisma.auditLog.findFirst({ where: { action: "DATABASE_SEEDED", entityType: "platform", entityId: "wind-edu" } });
  if (!baselineAudit) await prisma.auditLog.create({ data: { actorId: "usr-admin", action: "DATABASE_SEEDED", entityType: "platform", entityId: "wind-edu", context: { courseCode: course.code, classCode: learningClass.code } } });

  const summary = await seedDemoData({ prisma, passwordHash, questionHash });
  console.table(summary);
}

seed().then(() => console.log("Seed PostgreSQL hoàn tất.")).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
