import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { validateGradingDefinition } from "../../system/ai-grading-suggestion.js";
import {
  AssignmentSubmissionView,
  RubricCriterion,
  UploadedAssignmentFile,
} from "../academic.shared.js";
import {
  combineGradingSources,
  decodeGradingText,
  GRADING_TEXT_BYTE_LIMIT,
  isGradingDocument,
  type GradingAnswerSource,
  type GradingDocumentReader,
} from "../ai-grading-source.js";
import type { AcademicServiceContext } from "../academic.context.js";

/** Quét/lưu tệp trước khi upsert bài nộp và dọn object mới nếu transaction thất bại. */
export async function submitAssignment(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  content: string | undefined,
  session: AuthenticatedSession,
  files: UploadedAssignmentFile[] = [],
  expectedRevision?: number,
): Promise<AssignmentSubmissionView> {
  if (session.roleCode !== "LEARNER")
    throw new ForbiddenException("Chỉ học viên được nộp bài.");
  serviceContext.validateAssignmentFiles(files);
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
  if ((existing?.attachments.length ?? 0) + files.length > 5)
    throw new BadRequestException("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
  const normalizedContent = (content ?? existing?.content ?? "").trim();
  if (
    !normalizedContent &&
    !(existing?.attachments.length ?? 0) &&
    !files.length
  )
    throw new BadRequestException(
      "Cần nhập nội dung hoặc đính kèm ít nhất một tệp.",
    );

  const stored: Array<
    UploadedAssignmentFile & { objectKey: string; checksum: string }
  > = [];
  try {
    for (const file of files) {
      const scan = await serviceContext.antivirus.scan(file.buffer);
      if (!scan.clean)
        throw new BadRequestException(
          `Tệp ${file.originalName} không an toàn và đã bị từ chối.`,
        );
      const saved = await serviceContext.objectStorage.put(
        `assignment-submissions/${session.user.id}/${randomUUID()}`,
        file.buffer,
      );
      stored.push({ ...file, ...saved });
    }
    const row = await serviceContext.prisma.$transaction(
      async (transaction) => {
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
              originalName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: file.size,
              checksum: file.checksum,
            })),
          });
        const complete =
          await transaction.assignmentSubmission.findUniqueOrThrow({
            where: { id: submission.id },
            include: {
              learner: { select: { displayName: true, email: true } },
              attachments: {
                where: { removedAt: null },
                orderBy: { createdAt: "asc" },
              },
            },
          });
        await transaction.assignmentSubmissionRevision.create({
          data: {
            id: `submission-revision-${randomUUID()}`,
            submissionId: complete.id,
            revision: complete.revision,
            content: complete.content,
            attachments: complete.attachments.map((file) => ({
              id: file.id,
              objectKey: file.objectKey,
              originalName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes.toString(),
              checksum: file.checksum,
            })) as unknown as Prisma.InputJsonValue,
            submittedAt: complete.submittedAt,
          },
        });
        return complete;
      },
    );
    return serviceContext.mapSubmission(row);
  } catch (error) {
    await Promise.allSettled(
      stored.map((file) => serviceContext.objectStorage.remove(file.objectKey)),
    );
    throw error;
  }
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

/** Kiểm tra chủ sở hữu, xóa bản ghi tệp rồi dọn object khỏi storage. */
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
    const complete = await transaction.assignmentSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        learner: { select: { displayName: true, email: true } },
        attachments: {
          where: { removedAt: null },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    await transaction.assignmentSubmissionRevision.create({
      data: {
        id: `submission-revision-${randomUUID()}`,
        submissionId,
        revision: complete.revision,
        content: complete.content,
        attachments: complete.attachments.map((file) => ({
          id: file.id,
          objectKey: file.objectKey,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes.toString(),
          checksum: file.checksum,
        })) as unknown as Prisma.InputJsonValue,
        submittedAt: complete.submittedAt,
      },
    });
    return complete;
  });
  try {
    await serviceContext.objectStorage.remove(attachment.objectKey);
  } catch (error) {
    await serviceContext.prisma.assignmentSubmissionAttachment.update({
      where: { id: attachmentId },
      data: {
        removalError:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "Không xóa được object; cần retry.",
      },
    });
  }
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
    if (attachment.submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  } else {
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
    if (current.submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
  } else
    await serviceContext.requireTeachingAccess(
      current.submission.assignment.classId,
      session,
    );
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
  await serviceContext.requireTeachingAccess(assignment.classId, session);
  const rows = await serviceContext.prisma.assignmentSubmission.findMany({
    where: { assignmentId },
    include: {
      learner: { select: { displayName: true, email: true } },
      attachments: {
        where: { removedAt: null },
        orderBy: { createdAt: "asc" },
      },
      gradeChanges: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { submittedAt: "asc" },
  });
  return rows.map((row) => serviceContext.mapSubmission(row));
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
  const base = {
    submissionId: submission.id,
    submissionRevision: submission.revision,
    assignmentVersion: submission.assignment.version,
    instructions: [
      submission.assignment.title,
      submission.assignment.description,
      submission.assignment.instructions,
    ].join("\n\n"),
    answer: submission.content,
    rubric: serviceContext.rubric(submission.assignment.rubric),
  };
  validateGradingDefinition({
    instructions: base.instructions,
    rubric: submission.assignment.rubric,
  });
  if (!submission.attachments.length) {
    if (!submission.content.trim())
      throw new BadRequestException(
        "Bài nộp chưa có nội dung văn bản để gợi ý chấm.",
      );
    return base;
  }
  if (
    submission.attachments.length > 5 ||
    submission.attachments.some(
      (file) =>
        !(
          file.mimeType === "text/plain" && /\.txt$/i.test(file.originalName)
        ) &&
        !(readDocument && isGradingDocument(file.mimeType, file.originalName)),
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
  const sources: GradingAnswerSource[] = submission.content.trim()
    ? [
        {
          attachmentId: null,
          name: "Nội dung bài làm",
          checksum: null,
          text: submission.content,
        },
      ]
    : [];
  for (const file of submission.attachments) {
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
  const current = await serviceContext.prisma.assignmentSubmission.findUnique({
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
  if (!current) throw new NotFoundException("Không tìm thấy bài nộp.");
  await serviceContext.requireTeachingAccess(
    current.assignment.classId,
    session,
    true,
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
      submission.attachments.map((file) => [
        file.id,
        file.originalName,
        file.mimeType,
        file.checksum,
        String(file.sizeBytes),
      ]),
    );
  const sameAssignment =
    current.assignment.version === submission.assignment.version &&
    current.assignment.classId === submission.assignment.classId &&
    [
      current.assignment.title,
      current.assignment.description,
      current.assignment.instructions,
    ].join("\n\n") === base.instructions &&
    JSON.stringify(serviceContext.rubric(current.assignment.rubric)) ===
      JSON.stringify(base.rubric);
  if (
    current.revision !== submission.revision ||
    current.content !== submission.content ||
    !sameAssignment ||
    !sameFiles
  )
    throw new ConflictException(
      "Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.",
    );
  return { ...base, answer, sources };
}
