import { scryptSync } from "node:crypto";
import { config } from "dotenv";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client.js";

config({ path: new URL("../../../.env", import.meta.url) });

const databaseUrl = process.env.DATABASE_URL;
const defaultPassword = process.env.SEED_DEFAULT_PASSWORD;
if (!databaseUrl) throw new Error("Thiếu DATABASE_URL trong .env.");
if (!defaultPassword || defaultPassword.length < 12) throw new Error("SEED_DEFAULT_PASSWORD phải có ít nhất 12 ký tự.");

const url = new URL(databaseUrl);
const adapter = new PrismaMariaDb({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, ""), connectionLimit: 4 });
const prisma = new PrismaClient({ adapter });
const passwordHash = scryptSync(defaultPassword, "wind-edu-seed-v1", 64).toString("hex");

const permissions = ["user:view", "user:create", "user:update", "user:suspend", "role:view", "role:update", "course:view", "course:manage", "class:view", "class:manage", "material:view", "material:manage", "question:view", "question:manage", "exam:view", "exam:manage", "forum:view", "forum:post", "forum:moderate", "session:view", "session:manage", "report:view", "support:create", "support:manage", "system:configure"];
const roleMatrix = {
  SYSTEM_ADMIN: permissions,
  CENTER_MANAGER: ["course:view", "course:manage", "class:view", "class:manage", "material:view", "exam:view", "forum:view", "forum:moderate", "session:view", "report:view", "support:manage"],
  INSTRUCTOR: ["class:view", "material:view", "material:manage", "question:view", "question:manage", "exam:view", "exam:manage", "forum:view", "forum:moderate", "session:view", "session:manage", "report:view", "support:create"],
  LEARNER: ["class:view", "material:view", "exam:view", "forum:view", "forum:post", "session:view", "support:create"],
};
const roleNames = { SYSTEM_ADMIN: "Quản trị hệ thống", CENTER_MANAGER: "Quản lý trung tâm", INSTRUCTOR: "Giảng viên", LEARNER: "Học viên" };

async function seed() {
  for (const code of permissions) await prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: `Quyền ${code}` } });
  for (const [code, name] of Object.entries(roleNames)) {
    const role = await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name, description: `Vai trò ${name}` } });
    const permissionRows = await prisma.permission.findMany({ where: { code: { in: roleMatrix[code] } }, select: { id: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: permissionRows.map(({ id }) => ({ roleId: role.id, permissionId: id })) });
  }
  const users = [
    { id: "usr-admin", email: "admin@wind.edu.vn", displayName: "Wind Of Fall", role: "SYSTEM_ADMIN" },
    { id: "usr-manager", email: "manager@wind.edu.vn", displayName: "Nguyễn Minh Anh", role: "CENTER_MANAGER" },
    { id: "usr-instructor", email: "instructor@wind.edu.vn", displayName: "Trần Thu Hà", role: "INSTRUCTOR" },
    { id: "usr-learner", email: "learner@wind.edu.vn", displayName: "Lê Hoàng Nam", role: "LEARNER" },
  ];
  for (const input of users) {
    const user = await prisma.user.upsert({ where: { email: input.email }, update: { displayName: input.displayName, status: "ACTIVE" }, create: { id: input.id, email: input.email, displayName: input.displayName, passwordHash } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: input.role } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  }
  const course = await prisma.course.upsert({ where: { code: "WEB-FULLSTACK" }, update: { status: "PUBLISHED" }, create: { id: "course-web", code: "WEB-FULLSTACK", name: "Phát triển Web Full-stack", description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.", outcomes: ["Thiết kế giao diện responsive", "Xây dựng REST API", "Thiết kế cơ sở dữ liệu"], status: "PUBLISHED", ownerId: "usr-manager" } });
  const learningClass = await prisma.learningClass.upsert({ where: { code: "WEB-K01" }, update: { status: "ACTIVE" }, create: { id: "class-web-01", courseId: course.id, code: "WEB-K01", name: "Web Full-stack K01", term: "2026-HK1", startAt: new Date("2026-08-18T01:00:00.000Z"), endAt: new Date("2026-12-20T10:00:00.000Z"), capacity: 40, status: "ACTIVE" } });
  await prisma.classInstructor.upsert({ where: { classId_instructorId: { classId: learningClass.id, instructorId: "usr-instructor" } }, update: {}, create: { classId: learningClass.id, instructorId: "usr-instructor" } });
  await prisma.classEnrollment.upsert({ where: { classId_learnerId: { classId: learningClass.id, learnerId: "usr-learner" } }, update: { status: "ACTIVE" }, create: { classId: learningClass.id, learnerId: "usr-learner", status: "ACTIVE" } });
  await prisma.material.upsert({ where: { objectKey: "seed/web/architecture.pdf" }, update: {}, create: { id: "mat-web-intro", classId: learningClass.id, ownerId: "usr-instructor", name: "01 — Tổng quan kiến trúc Web.pdf", objectKey: "seed/web/architecture.pdf", mimeType: "application/pdf", sizeBytes: 2420000n, checksum: "sha256:seed-architecture", folder: "Tuần 1", tags: ["kiến trúc", "bắt đầu"], visibility: "PUBLISHED" } });
  const questionOne = await prisma.question.upsert({ where: { id: "q-rest-01" }, update: {}, create: { id: "q-rest-01", courseId: course.id, authorId: "usr-instructor", type: "SINGLE_CHOICE", content: "HTTP method nào phù hợp để cập nhật một phần tài nguyên?", options: ["GET", "POST", "PATCH", "DELETE"], correctAnswers: ["PATCH"], difficulty: 1, tags: ["http", "api"], status: "PUBLISHED" } });
  const questionTwo = await prisma.question.upsert({ where: { id: "q-db-01" }, update: {}, create: { id: "q-db-01", courseId: course.id, authorId: "usr-instructor", type: "TRUE_FALSE", content: "Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu.", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["database"], status: "PUBLISHED" } });
  const exam = await prisma.exam.upsert({ where: { id: "exam-mid-web" }, update: {}, create: { id: "exam-mid-web", classId: learningClass.id, title: "Kiểm tra giữa kỳ Web Full-stack", durationMinutes: 45, totalScore: 10, openAt: new Date("2026-08-20T00:00:00.000Z"), closeAt: new Date("2026-12-30T23:59:00.000Z"), attemptLimit: 2, status: "PUBLISHED" } });
  for (const [position, question] of [questionOne, questionTwo].entries()) await prisma.examQuestion.upsert({ where: { examId_questionId: { examId: exam.id, questionId: question.id } }, update: { position: position + 1 }, create: { examId: exam.id, questionId: question.id, position: position + 1, score: 5 } });
  const topic = await prisma.forumTopic.upsert({ where: { id: "topic-rest" }, update: {}, create: { id: "topic-rest", classId: learningClass.id, authorId: "usr-instructor", title: "Thảo luận: REST hay GraphQL?", body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.", tags: ["api", "thảo luận"], isPinned: true } });
  await prisma.forumPost.upsert({ where: { id: "post-rest-01" }, update: {}, create: { id: "post-rest-01", topicId: topic.id, authorId: "usr-learner", body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.", status: "PUBLISHED" } });
  await prisma.liveSession.upsert({ where: { id: "session-web-01" }, update: {}, create: { id: "session-web-01", classId: learningClass.id, hostId: "usr-instructor", title: "Thiết kế API có version", startsAt: new Date("2026-08-26T02:00:00.000Z"), endsAt: new Date("2026-08-26T03:30:00.000Z"), provider: "JITSI", hostUrl: "https://meet.jit.si/wind-web-01-host", attendeeUrl: "https://meet.jit.si/wind-web-01", status: "SCHEDULED" } });
  await prisma.systemSetting.upsert({ where: { key: "platform" }, update: {}, create: { key: "platform", value: { centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU", timezone: "Asia/Bangkok", locale: "vi-VN", retentionDays: 365, maxFileSizeMb: 50 }, updatedBy: "usr-admin" } });
  await prisma.auditLog.create({ data: { actorId: "usr-admin", action: "DATABASE_SEEDED", entityType: "platform", entityId: "wind-edu", context: { courseCode: course.code, classCode: learningClass.code } } });
}

seed().then(() => console.log("Seed MySQL hoàn tất.")).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
