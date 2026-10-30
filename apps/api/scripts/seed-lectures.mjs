import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { buildDatabaseUrl } from "../src/config/database-connection.js";

config({ path: new URL("../../../.env", import.meta.url) });

const adapter = new PrismaPg({ connectionString: buildDatabaseUrl(process.env), max: 4 });
const prisma = new PrismaClient({ adapter });

/** Đảm nhiệm seedPhysicalLectures trong phạm vi module hiện tại. */
async function seedPhysicalLectures() {
  console.log("Bắt đầu sinh dữ liệu bài giảng và bài tập lưu vật lý vào PostgreSQL...");

  // Tìm các lớp học đang hoạt động
  const classes = await prisma.learningClass.findMany({
    where: { status: "ACTIVE" },
    include: { course: true, instructors: true, exams: true, assignments: true },
  });

  if (classes.length === 0) {
    console.log("Không tìm thấy lớp học ACTIVE nào.");
    return;
  }

  for (const cls of classes) {
    const ownerId = cls.instructors[0]?.instructorId || "usr-instructor";
    const attachedExam = cls.exams[0] || null;

    const lectureRecords = [
      {
        id: `mat-lec-${cls.code.toLowerCase()}-01`,
        classId: cls.id,
        courseId: cls.courseId,
        ownerId,
        name: "Bài giảng 01: Đại cương về Hàm số bậc nhất và bậc hai",
        objectKey: `lectures/${cls.code.toLowerCase()}/lecture-01.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 45_000_000n,
        checksum: "sha256:lec-01",
        folder: "Toán 1",
        tags: [
          "video",
          "lecture",
          "bài giảng",
          "youtube:jfKfPfyJRdk",
          "Mô tả: Giới thiệu định nghĩa hàm số, tập xác định, khảo sát sự biến thiên và các dạng bài tập vẽ đồ thị cơ bản.",
          attachedExam ? `attachedExamId:${attachedExam.id}` : "",
          attachedExam ? `attachedExamTitle:${attachedExam.title}` : "",
        ].filter(Boolean),
        version: 1,
        visibility: "PUBLISHED",
      },
      {
        id: `mat-lec-${cls.code.toLowerCase()}-02`,
        classId: cls.id,
        courseId: cls.courseId,
        ownerId,
        name: "Bài giảng 02: Kỹ thuật phân tích đồ thị và tương giao hàm số",
        objectKey: `lectures/${cls.code.toLowerCase()}/lecture-02.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 52_000_000n,
        checksum: "sha256:lec-02",
        folder: "Toán 1",
        tags: [
          "video",
          "lecture",
          "bài giảng",
          "youtube:kJQP7kiw5Fk",
          "Mô tả: Phương pháp tương giao đồ thị, biện luận số nghiệm của phương trình và cực trị hàm bậc hai.",
          attachedExam ? `attachedExamId:${attachedExam.id}` : "",
          attachedExam ? `attachedExamTitle:${attachedExam.title}` : "",
        ].filter(Boolean),
        version: 1,
        visibility: "PUBLISHED",
      },
      {
        id: `mat-lec-${cls.code.toLowerCase()}-03`,
        classId: cls.id,
        courseId: cls.courseId,
        ownerId,
        name: "Phiếu bài tập trắc nghiệm toán học tách câu & slide tóm tắt",
        objectKey: `lectures/${cls.code.toLowerCase()}/lecture-doc-03.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 3_500_000n,
        checksum: "sha256:lec-03",
        folder: "Toán 1",
        tags: [
          "document",
          "lecture",
          "bài giảng",
          "tài liệu đính kèm",
          "Mô tả: Phiếu bài tập trắc nghiệm phân loại chi tiết và tổng hợp công thức toán học trọng tâm.",
          attachedExam ? `attachedExamId:${attachedExam.id}` : "",
          attachedExam ? `attachedExamTitle:${attachedExam.title}` : "",
        ].filter(Boolean),
        version: 1,
        visibility: "PUBLISHED",
      },
      {
        id: `mat-lec-${cls.code.toLowerCase()}-04`,
        classId: cls.id,
        courseId: cls.courseId,
        ownerId,
        name: "Bài giảng 03: Hình học không gian - Thể tích khối đa diện",
        objectKey: `lectures/${cls.code.toLowerCase()}/lecture-04.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 60_000_000n,
        checksum: "sha256:lec-04",
        folder: "Hình học",
        tags: [
          "video",
          "lecture",
          "bài giảng",
          "youtube:L_LUpnjgPso",
          "Mô tả: Công thức tính thể tích chóp, lăng trụ và các phương pháp phân chia khối đa diện nhanh chóng.",
        ],
        version: 1,
        visibility: "PUBLISHED",
      },
    ];

    for (const record of lectureRecords) {
      const saved = await prisma.material.upsert({
        where: { objectKey: record.objectKey },
        update: {
          name: record.name,
          folder: record.folder,
          tags: record.tags,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          visibility: record.visibility,
        },
        create: record,
      });

      await prisma.materialVersion.upsert({
        where: { materialId_version: { materialId: saved.id, version: 1 } },
        update: {
          name: saved.name,
          folder: saved.folder,
          tags: saved.tags,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          visibility: saved.visibility,
        },
        create: {
          id: `${saved.id}-v1`,
          materialId: saved.id,
          version: 1,
          name: saved.name,
          objectKey: saved.objectKey,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          checksum: saved.checksum,
          folder: saved.folder,
          tags: saved.tags,
          visibility: saved.visibility,
          createdBy: saved.ownerId,
        },
      });
    }

    // Đảm bảo bài thi của lớp có attempts và scores thật cho học viên
    if (attachedExam) {
      await prisma.examAttempt.upsert({
        where: {
          examId_learnerId_attemptNo: {
            examId: attachedExam.id,
            learnerId: "usr-learner",
            attemptNo: 1,
          },
        },
        update: {
          status: "GRADED",
          score: 4.0,
          submittedAt: new Date("2026-10-27T08:34:00.000Z"),
          feedback: "Em cần rèn luyện thêm phần giải phương trình bậc hai.",
        },
        create: {
          id: `attempt-${attachedExam.id}-usr-learner-1`,
          examId: attachedExam.id,
          learnerId: "usr-learner",
          attemptNo: 1,
          status: "GRADED",
          score: 4.0,
          submittedAt: new Date("2026-10-27T08:34:00.000Z"),
          feedback: "Em cần rèn luyện thêm phần giải phương trình bậc hai.",
        },
      });

      await prisma.examAttempt.upsert({
        where: {
          examId_learnerId_attemptNo: {
            examId: attachedExam.id,
            learnerId: "usr-learner",
            attemptNo: 2,
          },
        },
        update: {
          status: "GRADED",
          score: 9.0,
          submittedAt: new Date("2026-10-27T09:15:00.000Z"),
          feedback: "Bài làm rất tốt, các bước tính toán chính xác.",
        },
        create: {
          id: `attempt-${attachedExam.id}-usr-learner-2`,
          examId: attachedExam.id,
          learnerId: "usr-learner",
          attemptNo: 2,
          status: "GRADED",
          score: 9.0,
          submittedAt: new Date("2026-10-27T09:15:00.000Z"),
          feedback: "Bài làm rất tốt, các bước tính toán chính xác.",
        },
      });
    }
  }

  console.log("Hoàn tất sinh dữ liệu bài giảng và bài làm vật lý trong PostgreSQL!");
}

seedPhysicalLectures()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
