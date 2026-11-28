import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import type { ByteRange } from "../../../../infrastructure/http-range-stream.js";
import { openVerifiedObjectStream } from "../../../../infrastructure/verified-download.js";
import { validateGradingDefinition } from "../../../system/ai/ai-grading-suggestion.js";
import {
  AssignmentSubmissionView,
  AttachmentDocumentPreview,
  RubricCriterion,
  UploadedAssignmentFile,
} from "../../academic/academic.shared.js";
import { buildDocumentPreview } from "./academic-document-preview.js";
import {
  combineGradingSources,
  decodeGradingText,
  GRADING_TEXT_BYTE_LIMIT,
  isGradingDocument,
  type GradingAiContextMetadata,
  type GradingAnswerSource,
  type GradingDocumentReader,
} from "../../ai/ai-grading-source.js";
import type { AcademicServiceContext } from "../../academic/academic.context.js";

import type { Prisma } from "../../../../generated/prisma/client.js";
import { assertSafeUpload } from "../../../../infrastructure/file-signature.js";
import { normalizeMultipartFileName } from "../../../../infrastructure/file-transfer.js";
import { isAcademicSupervisor } from "./academic-access.js";

// Khóa các bản ghi bài tập, lớp học và ghi danh hợp lệ trước khi cập nhật bài nộp.
async function lockOpenAssignment(
  transaction: Prisma.TransactionClient,
  assignmentId: string,
  learnerId: string,
): Promise<void> {
  const [assignment] = await transaction.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM assignments a
    JOIN learning_classes c ON c.id = a.class_id
    JOIN class_enrollments e ON e.class_id = c.id AND e.learner_id = ${learnerId}
    WHERE a.id = ${assignmentId} AND NOT a.hidden AND a.status = 'PUBLISHED'
      AND c.status <> 'CLOSED' AND e.status = 'ACTIVE'
    FOR SHARE OF a, c, e
  `;
  if (!assignment) throw new NotFoundException("Không tìm thấy bài tập đang mở trong lớp của bạn.");
}

// Xóa tệp cũ khỏi storage sau khi transaction đã cam kết; giữ đánh dấu lỗi nếu storage từ chối để audit xử lý lại.
async function cleanupRemovedAttachments(
  serviceContext: AcademicServiceContext,
  attachments: Array<{ id: string; objectKey: string }>,
): Promise<void> {
  for (const attachment of attachments) {
    try {
      await serviceContext.objectStorage.remove(attachment.objectKey);
      await serviceContext.prisma.assignmentSubmissionAttachment.deleteMany({
        where: { id: attachment.id, removedAt: { not: null } },
      });
    } catch (error) {
      await serviceContext.prisma.assignmentSubmissionAttachment.updateMany({
        where: { id: attachment.id, removedAt: { not: null } },
        data: {
          removalError:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : "Không xóa được object; cần retry.",
        },
      });
    }
  }
}

/** Quét/lưu tệp trước khi upsert bài nộp và xử lý an toàn tệp cũ cùng gợi ý AI cũ khi nộp lại. */
export async function submitAssignment(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  content: string | undefined,
  session: AuthenticatedSession,
  files: UploadedAssignmentFile[] = [],
  expectedRevision?: number,
  keepAttachmentIds?: string[],
): Promise<AssignmentSubmissionView> {
  if (session.roleCode !== "LEARNER")
    throw new ForbiddenException("Chỉ học viên được nộp bài.");
  serviceContext.validateAssignmentFiles(files);
  // DOCX chỉ được kiểm 2 byte "PK" ở bước trên; kiểm sâu cấu trúc nén, XML và macro trước khi lưu.
  for (const file of files) await assertSafeUpload(file);
  const assignment = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      class: {
        include: {
          enrollments: {
            where: { learnerId: session.user.id, status: "ACTIVE" },
          },
        },
      },
    },
  });
  if (
    !assignment ||
    assignment.hidden ||
    !assignment.class.enrollments.length ||
    assignment.class.status === "CLOSED" ||
    assignment.status !== "PUBLISHED"
  )
    throw new NotFoundException(
      "Không tìm thấy bài tập đang mở trong lớp của bạn.",
    );
  if (assignment.dueAt < new Date())
    throw new ConflictException("Bài tập đã hết hạn nộp.");
  const existing = await serviceContext.prisma.assignmentSubmission.findUnique({
    where: {
      assignmentId_learnerId: { assignmentId, learnerId: session.user.id },
    },
    include: { attachments: { where: { removedAt: null } } },
  });
  if (existing?.status === "GRADED")
    throw new ConflictException("Bài đã chấm không thể nộp lại.");
  if (existing && expectedRevision !== existing.revision)
    throw new ConflictException(
      "Bài nộp đã thay đổi ở nơi khác. Hãy tải lại trước khi nộp.",
    );
  if (!existing && expectedRevision !== undefined && expectedRevision !== 0)
    throw new ConflictException(
      "Bài nộp chưa tồn tại nhưng phiên bản gửi lên không hợp lệ.",
    );

  const activeAttachments = existing?.attachments ?? [];
  let keptAttachments = activeAttachments;
  let removedAttachments: typeof activeAttachments = [];
  if (keepAttachmentIds !== undefined) {
    const activeIds = new Set(activeAttachments.map((file) => file.id));
    if (keepAttachmentIds.some((id) => !activeIds.has(id))) {
      throw new BadRequestException("Tệp đính kèm cần giữ lại không hợp lệ.");
    }
    const keptSet = new Set(keepAttachmentIds);
    keptAttachments = activeAttachments.filter((file) => keptSet.has(file.id));
    removedAttachments = activeAttachments.filter(
      (file) => !keptSet.has(file.id),
    );
  }

  if (keptAttachments.length + files.length > 5)
    throw new BadRequestException("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
  const normalizedContent = (content ?? existing?.content ?? "").trim();
  if (!normalizedContent && !keptAttachments.length && !files.length)
    throw new BadRequestException(
      "Cần nhập nội dung hoặc đính kèm ít nhất một tệp.",
    );

  const stored: Array<
    UploadedAssignmentFile & { objectKey: string; checksum: string }
  > = [];
  let row;
  try {
    for (const file of files) {
      const scan = file.path
        ? await serviceContext.antivirus.scanFile(file.path)
        : await serviceContext.antivirus.scan(file.buffer);
      if (!scan.clean)
        throw new BadRequestException(
          `Tệp ${file.originalName} không an toàn và đã bị từ chối.`,
        );
      const objectKey = `assignment-submissions/${session.user.id}/${randomUUID()}`;
      const saved = file.path
        ? await serviceContext.objectStorage.putFile(objectKey, file.path)
        : await serviceContext.objectStorage.put(objectKey, file.buffer);
      stored.push({ ...file, ...saved });
    }
    row = await serviceContext.prisma.$transaction(
      async (transaction) => {
        await lockOpenAssignment(transaction, assignmentId, session.user.id);
        const submittedAt = new Date();
        let submission;
        if (existing) {
          const updated = await transaction.assignmentSubmission.updateMany({
            where: {
              id: existing.id,
              revision: existing.revision,
              status: "SUBMITTED",
            },
            data: {
              content: normalizedContent,
              submittedAt,
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw new ConflictException(
              "Bài nộp vừa thay đổi hoặc đã được chấm. Hãy tải lại.",
            );
          if (removedAttachments.length) {
            await transaction.assignmentSubmissionAttachment.updateMany({
              where: {
                id: { in: removedAttachments.map((file) => file.id) },
                submissionId: existing.id,
                removedAt: null,
              },
              data: {
                removedAt: submittedAt,
                removedById: session.user.id,
                removalError: null,
              },
            });
          }
          await transaction.aiGradingSuggestion.deleteMany({
            where: { submissionId: existing.id },
          });
          submission = await transaction.assignmentSubmission.findUniqueOrThrow(
            { where: { id: existing.id } },
          );
        } else {
          submission = await transaction.assignmentSubmission.create({
            data: {
              id: `submission-${randomUUID()}`,
              assignmentId,
              learnerId: session.user.id,
              content: normalizedContent,
              submittedAt,
              revision: 1,
            },
          });
        }
        if (stored.length)
          await transaction.assignmentSubmissionAttachment.createMany({
            data: stored.map((file) => ({
              id: `submission-file-${randomUUID()}`,
              submissionId: submission.id,
              objectKey: file.objectKey,
              originalName: normalizeMultipartFileName(file.originalName),
              mimeType: file.mimeType,
              sizeBytes: file.size,
              checksum: file.checksum,
            })),
          });
        return await transaction.assignmentSubmission.findUniqueOrThrow({
          where: { id: submission.id },
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: {
              where: { removedAt: null },
              orderBy: { createdAt: "asc" },
            },
          },
        });
      },
    );
  } catch (error) {
    await Promise.allSettled(
      stored.map((file) => serviceContext.objectStorage.remove(file.objectKey)),
    );
    throw error;
  }
  try {
    await cleanupRemovedAttachments(serviceContext, removedAttachments);
  } catch (error) {
    Logger.error(error, "SubmissionAttachmentCleanup");
  }
  return serviceContext.mapSubmission(row);
}

/** Bổ sung tệp bằng cách dùng lại luồng submit và giữ nội dung hiện có. */
export async function addSubmissionAttachments(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  files: UploadedAssignmentFile[],
  session: AuthenticatedSession,
): Promise<AssignmentSubmissionView> {
  if (!files.length) throw new BadRequestException("Cần chọn ít nhất một tệp.");
  const submission =
    await serviceContext.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
    });
  if (!submission || submission.learnerId !== session.user.id)
    throw new NotFoundException("Không tìm thấy bài nộp của bạn.");
  return serviceContext.submitAssignment(
    submission.assignmentId,
    undefined,
    session,
    files,
    submission.revision,
  );
}

/** Kiểm tra chủ sở hữu, đánh dấu xóa và dọn tệp cùng gợi ý AI cũ khi bài còn ở trạng thái nộp. */
export async function removeSubmissionAttachment(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  attachmentId: string,
  expectedRevision: number,
  session: AuthenticatedSession,
): Promise<AssignmentSubmissionView> {
  if (session.roleCode !== "LEARNER")
    throw new ForbiddenException("Chỉ học viên được sửa tệp bài nộp.");
  const submission =
    await serviceContext.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: { include: { class: true } },
        attachments: { where: { removedAt: null } },
      },
    });
  if (!submission || submission.learnerId !== session.user.id)
    throw new NotFoundException("Không tìm thấy bài nộp của bạn.");
  if (submission.assignment.hidden) throw new NotFoundException("Không tìm thấy bài tập.");
  if (submission.assignment.class.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (submission.status === "GRADED")
    throw new ConflictException("Bài đã chấm không thể sửa tệp.");
  if (submission.assignment.dueAt < new Date())
    throw new ConflictException("Bài tập đã hết hạn chỉnh sửa.");
  const attachment = submission.attachments.find(
    (item) => item.id === attachmentId,
  );
  if (!attachment) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  if (!submission.content.trim() && submission.attachments.length === 1)
    throw new BadRequestException(
      "Bài nộp phải còn nội dung hoặc ít nhất một tệp.",
    );
  if (submission.revision !== expectedRevision)
    throw new ConflictException(
      "Bài nộp đã thay đổi ở nơi khác. Hãy tải lại trước khi xóa tệp.",
    );
  const row = await serviceContext.prisma.$transaction(async (transaction) => {
    await lockOpenAssignment(transaction, submission.assignmentId, session.user.id);
    const changed = await transaction.assignmentSubmission.updateMany({
      where: {
        id: submissionId,
        revision: expectedRevision,
        status: "SUBMITTED",
      },
      data: { revision: { increment: 1 }, submittedAt: new Date() },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        "Bài nộp vừa thay đổi hoặc đã được chấm. Hãy tải lại.",
      );
    await transaction.assignmentSubmissionAttachment.update({
      where: { id: attachmentId },
      data: {
        removedAt: new Date(),
        removedById: session.user.id,
        removalError: null,
      },
    });
    await transaction.aiGradingSuggestion.deleteMany({
      where: { submissionId },
    });
    return await transaction.assignmentSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        learner: { select: { displayName: true, email: true } },
        attachments: {
          where: { removedAt: null },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });
  await cleanupRemovedAttachments(serviceContext, [attachment]);
  return serviceContext.mapSubmission(row);
}

/** Đọc bytes bất biến có checksum; tái kiểm tra nguồn và quyền sau khi tải từ kho. */
export async function readSubmissionAttachment(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  attachmentId: string,
  session: AuthenticatedSession,
  expectedRevision?: number,
): Promise<{
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  checksum: string;
  submissionRevision: number;
}> {
  if (
    expectedRevision !== undefined &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  )
    throw new BadRequestException("Phiên bản bài nộp không hợp lệ.");
  const attachment =
    await serviceContext.prisma.assignmentSubmissionAttachment.findFirst({
      where: { id: attachmentId, submissionId, removedAt: null },
      include: { submission: { include: { assignment: true } } },
    });
  if (!attachment) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  if (session.roleCode === "LEARNER") {
    if (attachment.submission.assignment.hidden || attachment.submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  } else if (!isAcademicSupervisor(session)) {
    // Quản lý được mở tệp bài nộp để giám sát (chỉ đọc); giảng viên phải được phân công vào lớp.
    await serviceContext.requireTeachingAccess(
      attachment.submission.assignment.classId,
      session,
    );
  }
  if (
    expectedRevision !== undefined &&
    attachment.submission.revision !== expectedRevision
  )
    throw new ConflictException(
      "Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.",
    );
  const buffer = await serviceContext.objectStorage.get(attachment.objectKey);
  const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  if (
    BigInt(buffer.length) !== attachment.sizeBytes ||
    checksum !== attachment.checksum
  )
    throw new ConflictException(
      "Tệp bài nộp không khớp bản đã lưu. Không thể sử dụng nội dung; hãy liên hệ quản trị viên.",
    );
  const current =
    await serviceContext.prisma.assignmentSubmissionAttachment.findFirst({
      where: { id: attachmentId, submissionId, removedAt: null },
      include: { submission: { include: { assignment: true } } },
    });
  if (!current) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  if (session.roleCode === "LEARNER") {
    if (current.submission.assignment.hidden || current.submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  } else if (!isAcademicSupervisor(session)) {
    await serviceContext.requireTeachingAccess(
      current.submission.assignment.classId,
      session,
    );
  }
  if (
    current.objectKey !== attachment.objectKey ||
    current.checksum !== checksum ||
    current.sizeBytes !== attachment.sizeBytes ||
    current.originalName !== attachment.originalName ||
    current.mimeType !== attachment.mimeType ||
    current.submission.revision !== attachment.submission.revision ||
    current.submission.learnerId !== attachment.submission.learnerId ||
    current.submission.assignment.classId !==
      attachment.submission.assignment.classId ||
    current.submission.assignment.version !==
      attachment.submission.assignment.version
  )
    throw new ConflictException(
      "Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.",
    );
  return {
    buffer,
    fileName: attachment.originalName,
    mimeType: attachment.mimeType,
    checksum,
    submissionRevision: attachment.submission.revision,
  };
}

/** Mở luồng tải tệp bài nộp có hỗ trợ HTTP Range, kiểm chứng checksum theo stream và tái kiểm tra metadata/quyền trước khi phát byte. */
export async function readSubmissionAttachmentStream(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  attachmentId: string,
  session: AuthenticatedSession,
  rangeHeader?: string,
  expectedRevision?: number,
): Promise<{
  stream: Readable;
  totalSize: number;
  range?: ByteRange;
  fileName: string;
  mimeType: string;
  checksum: string;
  submissionRevision: number;
}> {
  if (
    expectedRevision !== undefined &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  )
    throw new BadRequestException("Phiên bản bài nộp không hợp lệ.");
  const attachment =
    await serviceContext.prisma.assignmentSubmissionAttachment.findFirst({
      where: { id: attachmentId, submissionId, removedAt: null },
      include: { submission: { include: { assignment: true } } },
    });
  if (!attachment) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  if (session.roleCode === "LEARNER") {
    if (attachment.submission.assignment.hidden || attachment.submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  } else if (!isAcademicSupervisor(session)) {
    await serviceContext.requireTeachingAccess(
      attachment.submission.assignment.classId,
      session,
    );
  }
  if (
    expectedRevision !== undefined &&
    attachment.submission.revision !== expectedRevision
  )
    throw new ConflictException(
      "Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.",
    );

  const opened = await openVerifiedObjectStream({
    objectStorage: serviceContext.objectStorage,
    objectKey: attachment.objectKey,
    checksum: attachment.checksum,
    expectedSize: Number(attachment.sizeBytes),
    rangeHeader,
    mismatchError: () =>
      new ConflictException(
        "Tệp bài nộp không khớp bản đã lưu. Không thể sử dụng nội dung; hãy liên hệ quản trị viên.",
      ),
  });

  try {
    const current =
      await serviceContext.prisma.assignmentSubmissionAttachment.findFirst({
        where: { id: attachmentId, submissionId, removedAt: null },
        include: { submission: { include: { assignment: true } } },
      });
    if (!current) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    if (session.roleCode === "LEARNER") {
      if (current.submission.assignment.hidden || current.submission.learnerId !== session.user.id)
        throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    } else if (!isAcademicSupervisor(session)) {
      await serviceContext.requireTeachingAccess(
        current.submission.assignment.classId,
        session,
      );
    }
    if (
      current.objectKey !== attachment.objectKey ||
      current.checksum !== attachment.checksum ||
      current.sizeBytes !== attachment.sizeBytes ||
      current.originalName !== attachment.originalName ||
      current.mimeType !== attachment.mimeType ||
      current.submission.revision !== attachment.submission.revision ||
      current.submission.learnerId !== attachment.submission.learnerId ||
      current.submission.assignment.classId !==
        attachment.submission.assignment.classId ||
      current.submission.assignment.version !==
        attachment.submission.assignment.version
    )
      throw new ConflictException(
        "Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.",
      );
    return {
      stream: opened.stream,
      totalSize: opened.totalSize,
      range: opened.range,
      fileName: attachment.originalName,
      mimeType: attachment.mimeType,
      checksum: attachment.checksum,
      submissionRevision: attachment.submission.revision,
    };
  } catch (error) {
    opened.stream.destroy();
    throw error;
  }
}

/** Liệt kê mọi bài nộp sau khi kiểm tra quyền giảng dạy. */
export async function listSubmissions(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  session: AuthenticatedSession,
): Promise<AssignmentSubmissionView[]> {
  const assignment = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) throw new NotFoundException("Không tìm thấy bài tập.");
  // Cấp quản lý xem danh sách bài nộp ở chế độ chỉ đọc; thao tác chấm vẫn yêu cầu giảng viên được phân công.
  if (!isAcademicSupervisor(session)) await serviceContext.requireTeachingAccess(assignment.classId, session);
  const rows = await serviceContext.prisma.assignmentSubmission.findMany({
    where: { assignmentId },
    include: {
      learner: { select: { displayName: true, email: true } },
      attachments: {
        where: { removedAt: null },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { submittedAt: "asc" },
  });
  return rows.map((row) => serviceContext.mapSubmission(row));
}

/** Tải và xác thực metadata bài nộp, rubric và tệp đính kèm trực tiếp từ DB (không đọc object storage). */
export async function gradingAiMetadata(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  expectedSubmissionRevision: number,
  session: AuthenticatedSession,
  allowDocuments = true,
): Promise<GradingAiContextMetadata> {
  if (
    !Number.isInteger(expectedSubmissionRevision) ||
    expectedSubmissionRevision < 1
  )
    throw new BadRequestException("Phiên bản bài nộp không hợp lệ.");
  const submission =
    await serviceContext.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: true,
        attachments: {
          where: { removedAt: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            checksum: true,
            sizeBytes: true,
          },
        },
      },
    });
  if (!submission) throw new NotFoundException("Không tìm thấy bài nộp.");
  await serviceContext.requireTeachingAccess(
    submission.assignment.classId,
    session,
    true,
  );
  if (submission.revision !== expectedSubmissionRevision)
    throw new ConflictException(
      "Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.",
    );
  const instructions = [
    submission.assignment.title,
    submission.assignment.description,
    submission.assignment.instructions,
  ].join("\n\n");
  const rubric = serviceContext.rubric(
    submission.assignment.rubric,
    Number(submission.assignment.maxScore),
  );
  validateGradingDefinition({
    instructions,
    rubric: submission.assignment.rubric,
  });
  if (!submission.attachments.length) {
    if (!submission.content.trim())
      throw new BadRequestException(
        "Bài nộp chưa có nội dung văn bản để gợi ý chấm.",
      );
  } else {
    if (
      submission.attachments.length > 5 ||
      submission.attachments.some(
        (file) =>
          !(
            file.mimeType === "text/plain" && /\.txt$/i.test(file.originalName)
          ) &&
          !(allowDocuments && isGradingDocument(file.mimeType, file.originalName)),
      )
    )
      throw new BadRequestException(
        "Chấm AI hỗ trợ văn bản, TXT, DOCX, PDF và ảnh PNG/JPEG/WebP. Hãy chấm thủ công Word DOC cũ hoặc định dạng khác để không bỏ sót nội dung tệp.",
      );
    if (
      submission.attachments.some(
        (file) =>
          file.mimeType === "text/plain" &&
          (file.sizeBytes <= 0n ||
            file.sizeBytes > BigInt(GRADING_TEXT_BYTE_LIMIT)),
      )
    )
      throw new BadRequestException(
        "Tệp TXT cho chấm AI phải có nội dung và không vượt quá 80.000 byte.",
      );
    if (
      submission.attachments.some(
        (file) => file.sizeBytes <= 0n || file.sizeBytes > 12n * 1024n * 1024n,
      ) ||
      submission.attachments.reduce((sum, file) => sum + file.sizeBytes, 0n) >
        24n * 1024n * 1024n
    )
      throw new BadRequestException(
        "Tệp trích xuất cho chấm AI phải từ 1 byte đến 12 MB, tổng không quá 24 MB.",
      );
  }
  return {
    submissionId: submission.id,
    submissionRevision: submission.revision,
    assignmentVersion: submission.assignment.version,
    instructions,
    inlineContent: submission.content,
    rubric,
    attachments: submission.attachments,
  };
}

/** Lấy đúng bài nộp và rubric cho AI, không đưa tên/email hoặc điểm cũ vào ngữ cảnh chấm. */
export async function gradingAiContext(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  expectedSubmissionRevision: number,
  session: AuthenticatedSession,
  readDocument?: GradingDocumentReader,
): Promise<{
  submissionId: string;
  submissionRevision: number;
  assignmentVersion: number;
  instructions: string;
  answer: string;
  rubric: RubricCriterion[];
  sources?: GradingAnswerSource[];
}> {
  const metadata = await gradingAiMetadata(
    serviceContext,
    submissionId,
    expectedSubmissionRevision,
    session,
    Boolean(readDocument),
  );
  const base = {
    submissionId: metadata.submissionId,
    submissionRevision: metadata.submissionRevision,
    assignmentVersion: metadata.assignmentVersion,
    instructions: metadata.instructions,
    answer: metadata.inlineContent,
    rubric: metadata.rubric,
  };
  if (!metadata.attachments.length) return base;
  const sources: GradingAnswerSource[] = metadata.inlineContent.trim()
    ? [
        {
          attachmentId: null,
          name: "Nội dung bài làm",
          checksum: null,
          text: metadata.inlineContent,
        },
      ]
    : [];
  for (const file of metadata.attachments) {
    const verified = await serviceContext.readSubmissionAttachment(
      submissionId,
      file.id,
      session,
      expectedSubmissionRevision,
    );
    if (
      verified.checksum !== file.checksum ||
      verified.fileName !== file.originalName ||
      verified.mimeType !== file.mimeType
    )
      throw new ConflictException(
        "Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.",
      );
    const text =
      verified.mimeType === "text/plain"
        ? decodeGradingText(verified.buffer)
        : decodeGradingText(
            Buffer.from(
              await readDocument!({ ...verified, attachmentId: file.id }),
              "utf8",
            ),
          );
    sources.push({
      attachmentId: file.id,
      name: verified.fileName,
      checksum: verified.checksum,
      text,
    });
  }
  const answer = combineGradingSources(sources);
  const current = await gradingAiMetadata(
    serviceContext,
    submissionId,
    expectedSubmissionRevision,
    session,
    Boolean(readDocument),
  );
  const sameFiles =
    JSON.stringify(
      current.attachments.map((file) => [
        file.id,
        file.originalName,
        file.mimeType,
        file.checksum,
        String(file.sizeBytes),
      ]),
    ) ===
    JSON.stringify(
      metadata.attachments.map((file) => [
        file.id,
        file.originalName,
        file.mimeType,
        file.checksum,
        String(file.sizeBytes),
      ]),
    );
  const sameAssignment =
    current.assignmentVersion === metadata.assignmentVersion &&
    current.instructions === metadata.instructions &&
    JSON.stringify(current.rubric) === JSON.stringify(metadata.rubric);
  if (
    current.submissionRevision !== metadata.submissionRevision ||
    current.inlineContent !== metadata.inlineContent ||
    !sameAssignment ||
    !sameFiles
  )
    throw new ConflictException(
      "Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.",
    );
  return { ...base, answer, sources };
}

/** Đọc và chuyển đổi nội dung tệp đính kèm bài nộp sang bản xem trước an toàn (DOCX/DOC/TXT). */
export async function previewSubmissionAttachment(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  attachmentId: string,
  session: AuthenticatedSession,
): Promise<AttachmentDocumentPreview> {
  const file = await readSubmissionAttachment(
    serviceContext,
    submissionId,
    attachmentId,
    session,
  );
  return await buildDocumentPreview(file);
}
