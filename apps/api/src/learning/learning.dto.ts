import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OmitType } from "@nestjs/swagger";
import type { LearningQuestion } from "./learning.types.js";

/** Từ khóa tùy chọn để tìm đoạn trong tài liệu đã được kiểm tra quyền. */
export class MaterialAiContextDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(1000) query?: string;
}

/** Câu hỏi và ngôn ngữ trả lời; nguồn chỉ được server lấy từ materialId đã kiểm tra quyền. */
export class MaterialAiQuestionDto {
  @IsString() @MinLength(2) @MaxLength(2000) question!: string;
  @IsOptional() @IsIn(["VI", "EN", "BILINGUAL"]) language: "VI" | "EN" | "BILINGUAL" = "VI";
}

/** Bộ ôn tập chỉ nhận phạm vi trang, số thẻ và ngôn ngữ; nguồn và model do máy chủ quản lý. */
export class MaterialStudyGuideDto {
  @IsInt() @Min(1) @Max(20) cardCount = 5;
  @IsIn(["VI", "EN", "BILINGUAL"]) language: "VI" | "EN" | "BILINGUAL" = "VI";
  @IsOptional() @IsInt() @Min(1) @Max(200) fromPage?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) toPage?: number;
}

/** Cursor chỉ định vị một bản nháp trong lịch sử của chính người gọi. */
export class StudyDraftListQueryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) cursor?: string;
}

/** Nội dung và đáp án sửa trong một đề nháp cụ thể. */
export class EditExamQuestionDto {
  @IsString() @MinLength(5) @MaxLength(20000) content!: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(5000, { each: true }) options!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(10000, { each: true }) correctAnswers!: string[];
  @IsInt() @Min(1) expectedVersion!: number;
}

/** Ghi nhận xác nhận duyệt câu hỏi khi gửi đề. */
export class SubmitExamDto {
  @IsOptional() @IsBoolean() confirmQuestions?: boolean;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

/** Dữ liệu tạo khóa học và phiên bản nội dung đầu tiên. */
export class CreateCourseDto {
  @IsString() @MinLength(2) @MaxLength(50) code!: string;
  @IsString() @MinLength(3) @MaxLength(200) name!: string;
  @IsString() @MinLength(10) description!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) outcomes!: string[];
}

export class UpdateCourseDto {
  @IsString() @MinLength(3) @MaxLength(200) name!: string;
  @IsString() @MinLength(10) description!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) outcomes!: string[];
}

export class ArchiveCourseDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

/** Dữ liệu mở lớp từ một phiên bản khóa học cùng quy mô và lịch vận hành. */
export class CreateClassDto {
  @IsString() courseId!: string;
  @IsString() @MinLength(2) code!: string;
  @IsString() @MinLength(3) name!: string;
  @IsString() term!: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsInt() @Min(1) @Max(1000) capacity!: number;
  @IsOptional() @IsString() timezone = "Asia/Bangkok";
  @IsOptional() @IsBoolean() allowLateEnrollment = false;
}

export class AssignUserDto {
  @IsString() @IsNotEmpty() userId!: string;
}

export class DirectoryQueryDto {
  @IsIn(["INSTRUCTOR", "LEARNER"]) role!: "INSTRUCTOR" | "LEARNER";
  @IsOptional() @IsString() @MaxLength(100) q = "";
  @IsOptional() @IsString() @MaxLength(191) classId?: string;
}

export class AssignInstructorDto extends AssignUserDto {
  @IsOptional() @IsIn(["PRIMARY", "CO_INSTRUCTOR"]) role?:
    | "PRIMARY"
    | "CO_INSTRUCTOR";
}

/** Bàn giao giảng viên chính với người nguồn kỳ vọng và lý do bắt buộc. */
export class TransferPrimaryInstructorDto {
  @IsString() @IsNotEmpty() newPrimaryId!: string;
  @IsString() @IsNotEmpty() expectedPrimaryId!: string;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class RemoveMemberDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class BulkEnrollmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds!: string[];
}

export class CloseClassDto {
  @IsString() @MinLength(5) @MaxLength(500) closeReason!: string;
  @IsIn(["STANDARD_RETENTION", "LONG_TERM_RETENTION"]) archivePolicy!:
    | "STANDARD_RETENTION"
    | "LONG_TERM_RETENTION";
}

export class ReopenClassDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class CreateMaterialDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
  @IsString() folder!: string;
  @IsArray() @IsString({ each: true }) tags!: string[];
}

/** Metadata đi kèm file upload học liệu; nội dung binary do interceptor cung cấp. */
export class UploadMaterialDto {
  @IsString() folder!: string;
  @IsOptional() @IsString() tags = "";
}

export class UpdateMaterialDto {
  @IsOptional() @IsString() folder?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(["DRAFT", "PUBLISHED", "HIDDEN"]) visibility?:
    | "DRAFT"
    | "PUBLISHED"
    | "HIDDEN";
}

export class ReviewMaterialDto {
  @IsIn(["APPROVE", "HIDE", "REQUEST_CHANGES"]) action!:
    | "APPROVE"
    | "HIDE"
    | "REQUEST_CHANGES";
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** Nội dung câu hỏi đa môn, hỗ trợ rich text/LaTeX, đáp án, độ khó và ảnh tùy chọn. */
export class CreateQuestionDto {
  @IsString() @IsNotEmpty() @MaxLength(191) courseId!: string;
  @IsIn([
    "SINGLE_CHOICE",
    "MULTIPLE_CHOICE",
    "TRUE_FALSE",
    "SHORT_ANSWER",
    "ESSAY",
  ])
  type!: LearningQuestion["type"];
  @IsString() @MinLength(5) @MaxLength(20_000) content!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(5_000, { each: true })
  options!: string[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(5_000, { each: true })
  correctAnswers!: string[];
  @IsInt() @Min(1) @Max(3) difficulty!: 1 | 2 | 3;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags!: string[];
}

export class UpdateQuestionDto extends CreateQuestionDto {}

export class ImportQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions!: CreateQuestionDto[];
}

/** Điểm tối đa của một câu trong đề. */
export class ExamScoreAllocationDto {
  @IsString() @IsNotEmpty() @MaxLength(191) questionId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) score!: number;
}

/** Cấu hình đề thi, danh sách câu theo thứ tự gốc và quy tắc mở/đóng/xáo trộn. */
export class CreateExamDto {
  @IsString() classId!: string;
  @IsString() @MinLength(3) title!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) questionIds!: string[];
  @IsInt() @Min(1) durationMinutes!: number;
  @IsNumber() @Min(1) totalScore!: number;
  @IsDateString() openAt!: string;
  @IsDateString() closeAt!: string;
  @IsInt() @Min(1) @Max(10) attemptLimit!: number;
  @IsOptional() @IsBoolean() shuffleQuestions = false;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) randomSeed?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamScoreAllocationDto)
  scoreAllocations?: ExamScoreAllocationDto[];
}

export class ReviewExamDto {
  @IsIn(["APPROVE", "RETURN"]) decision!: "APPROVE" | "RETURN";
  @IsOptional() @IsString() @MaxLength(1000) reviewNote?: string;
}

export class ReviewQuestionDto {
  @IsIn(["APPROVE", "RETURN"]) decision!: "APPROVE" | "RETURN";
  @IsOptional() @IsString() @MaxLength(1000) reviewNote?: string;
}

/** Đáp án tạm thời của một câu trong lượt thi đang làm. */
export class SaveAnswerDto {
  @IsString() @IsNotEmpty() @MaxLength(191) questionId!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20_000, { each: true })
  answers!: string[];
}

export class QuestionGradeDto {
  @IsString() @IsNotEmpty() @MaxLength(191) questionId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) score!: number;
}

/** Toàn bộ dữ liệu chỉnh sửa đề nháp kèm version chống ghi đè đồng thời. */
export class UpdateExamDto extends CreateExamDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

/** Một dòng trong ma trận số lượng câu hỏi mà AI phải tạo đúng tuyệt đối. */
export class AiQuestionDistributionDto {
  @IsIn([
    "SINGLE_CHOICE",
    "MULTIPLE_CHOICE",
    "TRUE_FALSE",
    "SHORT_ANSWER",
    "ESSAY",
  ])
  type!: LearningQuestion["type"];
  @IsInt() @Min(1) @Max(50) count!: number;
}

/** Cấu hình tạo đề AI, gồm lịch thi, trọng tâm, ma trận và phạm vi nguồn ngữ cảnh. */
export class GenerateAiExamDto extends OmitType(CreateExamDto, [
  "questionIds",
  "scoreAllocations",
] as const) {
  @IsOptional() @IsIn(["VI", "EN", "BILINGUAL"]) language: "VI" | "EN" | "BILINGUAL" = "VI";
  @IsUUID() clientRequestId!: string;
  @IsString() @MinLength(5) @MaxLength(5_000) focus!: string;
  @IsInt() @Min(1) @Max(3) difficulty!: 1 | 2 | 3;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AiQuestionDistributionDto)
  distribution!: AiQuestionDistributionDto[];
  @IsOptional()
  @IsIn(["AUTO", "COURSE_MATERIALS", "WEB_SEARCH"])
  contextMode: "AUTO" | "COURSE_MATERIALS" | "WEB_SEARCH" = "AUTO";
  @IsOptional() @IsString() @MaxLength(191) providerId?: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  materialIds?: string[];
}

export class GradeAttemptDto {
  @IsNumber() @Min(0) score!: number;
  @IsString() @MinLength(3) feedback!: string;
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  correctionReason?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionGradeDto)
  questionScores?: QuestionGradeDto[];
}

export class RequestRegradeDto {
  @IsString() @MinLength(10) reason!: string;
}

export class ResolveRegradeDto {
  @IsIn(["APPROVE", "REJECT"]) decision!: "APPROVE" | "REJECT";
  @IsString() @MinLength(5) @MaxLength(1_000) resolution!: string;
  @IsOptional() @IsNumber() @Min(0) score?: number;
  @IsOptional() @IsString() @MinLength(3) feedback?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionGradeDto)
  questionScores?: QuestionGradeDto[];
}

export class CreateTopicDto {
  @IsString() @MinLength(3) title!: string;
  @IsString() @MinLength(5) body!: string;
  @IsArray() @IsString({ each: true }) tags!: string[];
  @IsOptional() @IsBoolean() isPinned = false;
}

export class CreatePostDto {
  @IsString() @MinLength(2) body!: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  attachmentIds: string[] = [];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mentionedUserIds: string[] = [];
}

export class UpdatePostDto {
  @IsString() @MinLength(2) body!: string;
}
export class ModerateTopicDto {
  @IsOptional() @IsBoolean() isLocked?: boolean;
  @IsOptional() @IsBoolean() isPinned?: boolean;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class HideForumPostDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class CreateReportDto {
  @IsIn(["TOPIC", "POST"]) targetType!: "TOPIC" | "POST";
  @IsString() targetId!: string;
  @IsString() @MinLength(2) reason!: string;
  @IsString() @MinLength(3) details!: string;
}

export class ResolveReportDto {
  @IsIn(["HIDE_CONTENT", "KEEP_CONTENT", "ESCALATE_ADMIN"]) action!:
    | "HIDE_CONTENT"
    | "KEEP_CONTENT"
    | "ESCALATE_ADMIN";
  @IsString() @MinLength(3) resolution!: string;
}

export class AppealReportDto {
  @IsString() @MinLength(10) reason!: string;
}

/** Dữ liệu lên lịch buổi học trực tuyến và nhà cung cấp phòng họp. */
export class CreateSessionDto {
  @IsString() @MinLength(3) title!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsIn(["GOOGLE_MEET", "ZOOM", "JITSI"]) provider!:
    | "GOOGLE_MEET"
    | "ZOOM"
    | "JITSI";
}

export class UpdateSessionDto extends CreateSessionDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class CancelSessionDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class TransitionSessionDto {
  @IsIn(["LIVE", "COMPLETED", "CANCELLED"]) status!:
    | "LIVE"
    | "COMPLETED"
    | "CANCELLED";
}

/** Điều chỉnh điểm danh thủ công kèm lý do để phục vụ audit. */
export class UpdateAttendanceDto {
  @IsString() learnerId!: string;
  @IsIn(["PRESENT", "LATE", "ABSENT", "EXCUSED"]) status!:
    | "PRESENT"
    | "LATE"
    | "ABSENT"
    | "EXCUSED";
  @IsInt() @Min(0) attendedMinutes!: number;
  @IsString() @MinLength(3) adjustmentReason!: string;
}

export class AttachRecordingDto {
  @IsUrl({ require_tld: false }) recordingUrl!: string;
}
export class CompleteRecordingDto {
  @IsIn(["READY", "FAILED"]) status!: "READY" | "FAILED";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) retentionDays =
    90;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) errorMessage?: string;
}
export class CreateAttendanceAppealDto {
  @IsString() @MinLength(10) reason!: string;
}

export class ProviderAttendanceRowDto {
  @IsString() @MinLength(1) @MaxLength(191) providerParticipantId!: string;
  @IsString() @MinLength(1) learnerId!: string;
  @IsDateString() joinedAt!: string;
  @IsDateString() leftAt!: string;
}

export class SyncAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProviderAttendanceRowDto)
  records!: ProviderAttendanceRowDto[];
}

export class ResolveAttendanceAppealDto {
  @IsIn(["APPROVE", "REJECT"]) decision!: "APPROVE" | "REJECT";
  @IsString() @MinLength(5) resolution!: string;
  @IsOptional()
  @IsIn(["PRESENT", "LATE", "ABSENT", "EXCUSED"])
  status?: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
  @IsOptional() @IsInt() @Min(0) attendedMinutes?: number;
}

/** Bộ ngưỡng lọc dùng khi tổng hợp tiến độ lớp và phát hiện học viên cần hỗ trợ. */
export class ProgressQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) attendanceBelow =
    70;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) scoreBelow = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) completionBelow =
    60;
}

export class CreateProgressInterventionDto {
  @IsString() @IsNotEmpty() learnerId!: string;
  @IsString() @IsNotEmpty() assigneeId!: string;
  @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsDateString() dueAt!: string;
}

export class UpdateProgressInterventionDto {
  @IsIn(["IN_PROGRESS", "DONE", "CANCELLED"]) status!:
    | "IN_PROGRESS"
    | "DONE"
    | "CANCELLED";
  @IsOptional() @IsString() @MinLength(5) @MaxLength(2000) outcome?: string;
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  cancellationReason?: string;
}

export class TransferProgressInterventionDto {
  @IsString() @IsNotEmpty() assigneeId!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class RunOperationalReportDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
}

export class CreateReportExportDto {
  @IsString() @IsNotEmpty() reportRunId!: string;
  @IsIn(["CSV"]) format!: "CSV";
}

/** Nội dung phiếu hỗ trợ và mức ưu tiên do người dùng gửi. */
export class CreateTicketDto {
  @IsUUID() clientRequestId!: string;
  @IsString() category!: string;
  @IsIn(["P0", "P1", "P2", "P3"]) severity!: "P0" | "P1" | "P2" | "P3";
  @IsString() @MinLength(10) description!: string;
  @IsOptional() @IsString() @MaxLength(191) contextId?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) status?:
    | "OPEN"
    | "IN_PROGRESS"
    | "RESOLVED"
    | "CLOSED";
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsDateString() expectedUpdatedAt!: string;
}

export class CreateTicketCommentDto {
  @IsString() @MinLength(2) body!: string;
}
