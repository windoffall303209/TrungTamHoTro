import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import { id, MaterialDownload, now } from "../../core/learning.shared.js";
import type {
  OperationalReport,
  ReportExport,
  ReportRun,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Tạo snapshot báo cáo vận hành có checksum để các bản xuất dùng dữ liệu bất biến. */
export async function runOperationalReport(
  serviceContext: LearningServiceContext,
  fromInput: string,
  toInput: string,
  requestedById = "usr-manager",
): Promise<ReportRun> {
  const { from, to } = serviceContext.reportingPeriod(fromInput, toInput);
  const result = await serviceContext.getOperationalReport(
    from.toISOString(),
    to.toISOString(),
  );
  const run: ReportRun = {
    id: id("report-run"),
    reportType: "OPERATIONS",
    definitionVersion: result.definitionVersion,
    timezone: result.timezone,
    filters: { from: from.toISOString(), to: to.toISOString() },
    result,
    requestedById,
    createdAt: now(),
  };
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.reportRun.create({
      data: {
        id: run.id,
        reportType: run.reportType,
        definitionVersion: run.definitionVersion,
        timezone: run.timezone,
        filters: run.filters,
        result: run.result as unknown as Prisma.InputJsonValue,
        requestedById,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: requestedById,
        action: "OPERATIONAL_REPORT_RUN",
        entityType: "report_run",
        entityId: row.id,
        context: run.filters,
      },
    });
    return { ...run, createdAt: row.createdAt.toISOString() };
  }
  serviceContext.reportRuns.unshift(run);
  return structuredClone(run);
}

/** Kết xuất snapshot báo cáo thành CSV, lưu object và bản ghi trạng thái READY/FAILED. */
export async function createReportExport(
  serviceContext: LearningServiceContext,
  reportRunId: string,
  format: "CSV",
  requestedById = "usr-manager",
): Promise<ReportExport> {
  const prisma = serviceContext.database();
  const run = prisma
    ? await prisma.reportRun.findFirst({
        where: { id: reportRunId, requestedById },
      })
    : serviceContext.reportRuns.find(
        (item) =>
          item.id === reportRunId && item.requestedById === requestedById,
      );
  if (!run)
    throw new NotFoundException(
      "Không tìm thấy lần chạy báo cáo được phép xuất.",
    );
  const exportId = id("report-export");
  const fileName = `bao-cao-van-hanh-${new Date().toISOString().slice(0, 10)}-${exportId.slice(-8)}.csv`;
  const objectKey = `report-exports/${exportId}.csv`;
  const expiresAt = new Date(Date.now() + 24 * 3_600_000);
  const result = ("result" in run
    ? run.result
    : {}) as unknown as OperationalReport;
  const csv = serviceContext.operationalReportCsv(result);
  if (prisma)
    await prisma.reportExport.create({
      data: {
        id: exportId,
        reportRunId,
        format,
        fileName,
        expiresAt,
        requestedById,
      },
    });
  try {
    const exportBuffer = Buffer.from(`\uFEFF${csv}`, "utf8");
    const stored = await serviceContext.writeStoredFile(
      objectKey,
      exportBuffer,
    );
    const sizeBytes = exportBuffer.length;
    if (prisma) {
      const row = await prisma.reportExport.update({
        where: { id: exportId },
        data: { status: "COMPLETED", filePath: stored.objectKey, sizeBytes },
      });
      await prisma.auditLog.create({
        data: {
          actorId: requestedById,
          action: "OPERATIONAL_REPORT_EXPORTED",
          entityType: "report_export",
          entityId: exportId,
          context: {
            reportRunId,
            format,
            sizeBytes,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return serviceContext.mapReportExport(row);
    }
    const item: ReportExport & { filePath: string; requestedById: string } = {
      id: exportId,
      reportRunId,
      format,
      status: "COMPLETED",
      fileName,
      filePath: stored.objectKey,
      requestedById,
      sizeBytes,
      expiresAt: expiresAt.toISOString(),
      createdAt: now(),
    };
    serviceContext.reportExports.unshift(item);
    return { ...item, filePath: undefined } as ReportExport;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không thể tạo tệp xuất báo cáo.";
    if (prisma)
      await prisma.reportExport.update({
        where: { id: exportId },
        data: { status: "FAILED", errorMessage: message },
      });
    throw new BadRequestException("Không thể tạo tệp xuất báo cáo.");
  }
}

/** Liệt kê bản xuất do người dùng yêu cầu theo thời gian mới nhất. */
export async function listReportExports(
  serviceContext: LearningServiceContext,
  requestedById = "usr-manager",
): Promise<ReportExport[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.reportExport.findMany({
      where: { requestedById },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((row) => serviceContext.mapReportExport(row));
  }
  return serviceContext.reportExports
    .filter(
      (item) =>
        item.requestedById === requestedById && item.status !== "EXPIRED",
    )
    .map((item) => ({
      id: item.id,
      reportRunId: item.reportRunId,
      format: item.format,
      status: item.status,
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      errorMessage: item.errorMessage,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
    }));
}

/** Kiểm tra chủ sở hữu/trạng thái rồi đọc tệp báo cáo từ storage. */
export async function downloadReportExport(
  serviceContext: LearningServiceContext,
  exportId: string,
  requestedById = "usr-manager",
): Promise<MaterialDownload> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.reportExport.findFirst({
      where: { id: exportId, requestedById },
    });
    if (!row) throw new NotFoundException("Không tìm thấy tệp xuất báo cáo.");
    if (row.expiresAt <= new Date()) {
      await prisma.reportExport.update({
        where: { id: exportId },
        data: { status: "EXPIRED" },
      });
      throw new BadRequestException("Tệp xuất báo cáo đã hết hạn.");
    }
    if (row.status !== "COMPLETED" || !row.filePath)
      throw new ConflictException("Tệp xuất báo cáo chưa sẵn sàng.");
    return {
      fileName: row.fileName,
      mimeType: "text/csv; charset=utf-8",
      buffer: await serviceContext.readStoredFile(row.filePath),
    };
  }
  const item = serviceContext.reportExports.find(
    (candidate) =>
      candidate.id === exportId && candidate.requestedById === requestedById,
  );
  if (!item) throw new NotFoundException("Không tìm thấy tệp xuất báo cáo.");
  if (new Date(item.expiresAt) <= new Date()) {
    item.status = "EXPIRED";
    throw new BadRequestException("Tệp xuất báo cáo đã hết hạn.");
  }
  if (item.status !== "COMPLETED" || !item.filePath)
    throw new ConflictException("Tệp xuất báo cáo chưa sẵn sàng.");
  return {
    fileName: item.fileName,
    mimeType: "text/csv; charset=utf-8",
    buffer: await serviceContext.readStoredFile(item.filePath),
  };
}

/** Đối soát số liệu khóa/lớp/học liệu/thi/phiếu trong kỳ và gắn cảnh báo vận hành. */
export async function getOperationalReport(
  serviceContext: LearningServiceContext,
  fromInput?: string,
  toInput?: string,
): Promise<OperationalReport> {
  const { from, to } = serviceContext.reportingPeriod(fromInput, toInput);
  const createdAt = { gte: from, lte: to };
  const metadata = {
    definitionVersion: "1.0.0",
    timezone: "Asia/Bangkok",
    metricDefinitions: {
      courses: "Số khóa học được tạo trong kỳ báo cáo.",
      classes: "Số lớp học được tạo trong kỳ báo cáo.",
      activeClasses: "Số lớp đang hoạt động và được tạo trong kỳ báo cáo.",
      learners: "Số học viên duy nhất đang có ghi danh hoạt động.",
      materials: "Số học liệu được tạo trong kỳ báo cáo.",
      exams: "Số đề kiểm tra được tạo trong kỳ báo cáo.",
      liveSessions: "Số buổi học trực tuyến bắt đầu trong kỳ báo cáo.",
      openReports: "Báo cáo diễn đàn chưa kết thúc được tạo trong kỳ báo cáo.",
      openTickets: "Phiếu hỗ trợ chưa kết thúc được tạo trong kỳ báo cáo.",
    },
  };
  const prisma = serviceContext.database();
  if (prisma) {
    const [
      courses,
      classes,
      activeClasses,
      learnerRows,
      materials,
      publishedMaterials,
      questions,
      exams,
      liveSessions,
      openReports,
      openTickets,
    ] = await prisma.$transaction([
      prisma.course.count({ where: { createdAt } }),
      prisma.learningClass.count({ where: { createdAt } }),
      prisma.learningClass.count({ where: { status: "ACTIVE", createdAt } }),
      prisma.classEnrollment.findMany({
        where: { status: "ACTIVE" },
        distinct: ["learnerId"],
        select: { learnerId: true },
      }),
      prisma.material.count({ where: { createdAt } }),
      prisma.material.count({
        where: { visibility: "PUBLISHED", createdAt },
      }),
      prisma.question.count({ where: { createdAt } }),
      prisma.exam.count({ where: { createdAt } }),
      prisma.liveSession.count({ where: { startsAt: createdAt } }),
      prisma.contentReport.count({
        where: {
          status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] },
          createdAt,
        },
      }),
      prisma.supportTicket.count({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt },
      }),
    ]);
    return {
      courses,
      classes,
      activeClasses,
      learners: learnerRows.length,
      materials,
      publishedMaterials,
      questions,
      exams,
      liveSessions,
      openReports,
      openTickets,
      generatedAt: now(),
      ...metadata,
    };
  }
  const classes = serviceContext.classes.filter(
    (item) => item.status === "ACTIVE",
  ).length;
  const materials = serviceContext.materials.filter(
    (item) => item.visibility === "PUBLISHED",
  ).length;
  return {
    courses: serviceContext.courses.length,
    classes,
    activeClasses: classes,
    learners: new Set(serviceContext.classes.flatMap((item) => item.learnerIds))
      .size,
    materials,
    publishedMaterials: materials,
    questions: serviceContext.questions.length,
    exams: serviceContext.exams.length,
    liveSessions: serviceContext.sessions.filter(
      (item) =>
        new Date(item.startsAt) >= from && new Date(item.startsAt) <= to,
    ).length,
    openReports: serviceContext.reports.filter(
      (item) =>
        ["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status) &&
        new Date(item.createdAt) >= from &&
        new Date(item.createdAt) <= to,
    ).length,
    openTickets: serviceContext.tickets.filter(
      (item) =>
        !["RESOLVED", "CLOSED"].includes(item.status) &&
        new Date(item.createdAt) >= from &&
        new Date(item.createdAt) <= to,
    ).length,
    generatedAt: now(),
    ...metadata,
  };
}

/** Tổng hợp quy mô, lịch, học liệu và điểm trung bình cho từng lớp. */
export async function getClassReports(
  serviceContext: LearningServiceContext,
): Promise<object[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const classes = await prisma.learningClass.findMany({
      include: {
        instructors: true,
        enrollments: { where: { status: "ACTIVE" } },
        materials: {
          where: { visibility: "PUBLISHED" },
          select: { id: true },
        },
        exams: { include: { attempts: true } },
        sessions: { include: { attendance: true } },
      },
      orderBy: { startAt: "desc" },
    });
    return classes.map((classItem) => {
      const attempts = classItem.exams.flatMap((exam) => exam.attempts);
      const graded = attempts.filter((attempt) => attempt.score !== null);
      const attendance = classItem.sessions.flatMap(
        (session) => session.attendance,
      );
      const attendanceDenominator =
        classItem.enrollments.length * classItem.sessions.length;
      return {
        classId: classItem.id,
        classCode: classItem.code,
        className: classItem.name,
        learners: classItem.enrollments.length,
        instructors: classItem.instructors.length,
        publishedMaterials: classItem.materials.length,
        exams: classItem.exams.length,
        submittedAttempts: attempts.filter(
          (attempt) => attempt.status !== "IN_PROGRESS",
        ).length,
        averageScore: graded.length
          ? Math.round(
              (graded.reduce((sum, attempt) => sum + Number(attempt.score), 0) /
                graded.length) *
                100,
            ) / 100
          : 0,
        sessions: classItem.sessions.length,
        attendanceRate: attendanceDenominator
          ? Math.round(
              (attendance.filter(
                (row) => row.status === "PRESENT" || row.status === "LATE",
              ).length /
                attendanceDenominator) *
                100,
            )
          : 0,
        status: classItem.status,
      };
    });
  }
  return serviceContext.classes.map((classItem) => {
    const classExams = serviceContext.exams.filter(
      (exam) => exam.classId === classItem.id,
    );
    const classAttempts = serviceContext.attempts.filter((attempt) =>
      classExams.some((exam) => exam.id === attempt.examId),
    );
    const classSessions = serviceContext.sessions.filter(
      (session) => session.classId === classItem.id,
    );
    const attendanceRows = serviceContext.attendance.filter((record) =>
      classSessions.some((session) => session.id === record.sessionId),
    );
    const graded = classAttempts.filter(
      (attempt) => attempt.score !== undefined,
    );
    return {
      classId: classItem.id,
      classCode: classItem.code,
      className: classItem.name,
      learners: classItem.learnerIds.length,
      instructors: classItem.instructorIds.length,
      publishedMaterials: serviceContext.materials.filter(
        (material) =>
          material.classId === classItem.id &&
          material.visibility === "PUBLISHED",
      ).length,
      exams: classExams.length,
      submittedAttempts: classAttempts.filter(
        (attempt) => attempt.status !== "IN_PROGRESS",
      ).length,
      averageScore: graded.length
        ? Math.round(
            (graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) /
              graded.length) *
              100,
          ) / 100
        : 0,
      sessions: classSessions.length,
      attendanceRate:
        classItem.learnerIds.length && classSessions.length
          ? Math.round(
              (attendanceRows.filter(
                (row) => row.status === "PRESENT" || row.status === "LATE",
              ).length /
                (classItem.learnerIds.length * classSessions.length)) *
                100,
            )
          : 0,
      status: classItem.status,
    };
  });
}
