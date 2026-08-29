import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { LearningQuestion } from "./learning.types.js";

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

export class ArchiveCourseDto { @IsString() @MinLength(5) @MaxLength(500) reason!: string; }

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

export class AssignUserDto { @IsString() @IsNotEmpty() userId!: string; }

export class DirectoryQueryDto {
  @IsIn(["INSTRUCTOR", "LEARNER"]) role!: "INSTRUCTOR" | "LEARNER";
  @IsOptional() @IsString() @MaxLength(100) q = "";
  @IsOptional() @IsString() @MaxLength(191) classId?: string;
}

export class AssignInstructorDto extends AssignUserDto {
  @IsIn(["PRIMARY", "CO_INSTRUCTOR"]) role!: "PRIMARY" | "CO_INSTRUCTOR";
}

export class RemoveMemberDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class BulkEnrollmentDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) userIds!: string[];
}

export class CloseClassDto {
  @IsString() @MinLength(5) @MaxLength(500) closeReason!: string;
  @IsIn(["STANDARD_RETENTION", "LONG_TERM_RETENTION"]) archivePolicy!: "STANDARD_RETENTION" | "LONG_TERM_RETENTION";
}

export class ReopenClassDto { @IsString() @MinLength(5) @MaxLength(500) reason!: string; }

export class CreateMaterialDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
  @IsString() folder!: string;
  @IsArray() @IsString({ each: true }) tags!: string[];
}

export class UploadMaterialDto {
  @IsString() folder!: string;
  @IsOptional() @IsString() tags = "";
}

export class UpdateMaterialDto {
  @IsOptional() @IsString() folder?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(["DRAFT", "PUBLISHED", "HIDDEN"]) visibility?: "DRAFT" | "PUBLISHED" | "HIDDEN";
}

export class ReviewMaterialDto {
  @IsIn(["APPROVE", "HIDE", "REQUEST_CHANGES"]) action!: "APPROVE" | "HIDE" | "REQUEST_CHANGES";
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CreateQuestionDto {
  @IsString() courseId!: string;
  @IsIn(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"]) type!: LearningQuestion["type"];
  @IsString() @MinLength(5) content!: string;
  @IsArray() @IsString({ each: true }) options!: string[];
  @IsArray() @IsString({ each: true }) correctAnswers!: string[];
  @IsInt() @Min(1) @Max(3) difficulty!: 1 | 2 | 3;
  @IsArray() @IsString({ each: true }) tags!: string[];
}

export class UpdateQuestionDto extends CreateQuestionDto {}

export class ImportQuestionsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => CreateQuestionDto)
  questions!: CreateQuestionDto[];
}

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
}

export class ReviewExamDto {
  @IsIn(["APPROVE", "RETURN"]) decision!: "APPROVE" | "RETURN";
  @IsOptional() @IsString() @MaxLength(1000) reviewNote?: string;
}

export class SaveAnswerDto {
  @IsString() questionId!: string;
  @IsArray() @IsString({ each: true }) answers!: string[];
}

export class GradeAttemptDto {
  @IsNumber() @Min(0) score!: number;
  @IsString() @MinLength(3) feedback!: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) correctionReason?: string;
}

export class RequestRegradeDto {
  @IsString() @MinLength(10) reason!: string;
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
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) attachmentIds: string[] = [];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) mentionedUserIds: string[] = [];
}

export class UpdatePostDto { @IsString() @MinLength(2) body!: string; }
export class ModerateTopicDto {
  @IsOptional() @IsBoolean() isLocked?: boolean;
  @IsOptional() @IsBoolean() isPinned?: boolean;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class HideForumPostDto { @IsString() @MinLength(5) @MaxLength(500) reason!: string; }

export class CreateReportDto {
  @IsIn(["TOPIC", "POST"]) targetType!: "TOPIC" | "POST";
  @IsString() targetId!: string;
  @IsString() @MinLength(2) reason!: string;
  @IsString() @MinLength(3) details!: string;
}

export class ResolveReportDto {
  @IsIn(["HIDE_CONTENT", "KEEP_CONTENT", "ESCALATE_ADMIN"]) action!: "HIDE_CONTENT" | "KEEP_CONTENT" | "ESCALATE_ADMIN";
  @IsString() @MinLength(3) resolution!: string;
}

export class AppealReportDto {
  @IsString() @MinLength(10) reason!: string;
}

export class CreateSessionDto {
  @IsString() @MinLength(3) title!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsIn(["GOOGLE_MEET", "ZOOM", "JITSI"]) provider!: "GOOGLE_MEET" | "ZOOM" | "JITSI";
}

export class UpdateSessionDto extends CreateSessionDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class CancelSessionDto { @IsString() @MinLength(5) @MaxLength(500) reason!: string; }

export class TransitionSessionDto { @IsIn(["LIVE", "COMPLETED", "CANCELLED"]) status!: "LIVE" | "COMPLETED" | "CANCELLED"; }

export class UpdateAttendanceDto {
  @IsString() learnerId!: string;
  @IsIn(["PRESENT", "LATE", "ABSENT", "EXCUSED"]) status!: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
  @IsInt() @Min(0) attendedMinutes!: number;
  @IsString() @MinLength(3) adjustmentReason!: string;
}

export class AttachRecordingDto { @IsUrl({ require_tld: false }) recordingUrl!: string; }
export class CompleteRecordingDto {
  @IsIn(["READY", "FAILED"]) status!: "READY" | "FAILED";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) retentionDays = 90;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) errorMessage?: string;
}
export class CreateAttendanceAppealDto { @IsString() @MinLength(10) reason!: string; }

export class ProviderAttendanceRowDto {
  @IsString() @MinLength(1) @MaxLength(191) providerParticipantId!: string;
  @IsString() @MinLength(1) learnerId!: string;
  @IsDateString() joinedAt!: string;
  @IsDateString() leftAt!: string;
}

export class SyncAttendanceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => ProviderAttendanceRowDto)
  records!: ProviderAttendanceRowDto[];
}

export class ResolveAttendanceAppealDto {
  @IsIn(["APPROVE", "REJECT"]) decision!: "APPROVE" | "REJECT";
  @IsString() @MinLength(5) resolution!: string;
  @IsOptional() @IsIn(["PRESENT", "LATE", "ABSENT", "EXCUSED"])
  status?: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
  @IsOptional() @IsInt() @Min(0) attendedMinutes?: number;
}

export class ProgressQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) attendanceBelow = 70;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) scoreBelow = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) completionBelow = 60;
}

export class CreateProgressInterventionDto {
  @IsString() @IsNotEmpty() learnerId!: string;
  @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsDateString() dueAt!: string;
}

export class UpdateProgressInterventionDto {
  @IsIn(["DONE", "CANCELLED"]) status!: "DONE" | "CANCELLED";
}

export class RunOperationalReportDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
}

export class CreateReportExportDto {
  @IsString() @IsNotEmpty() reportRunId!: string;
  @IsIn(["CSV"]) format!: "CSV";
}

export class CreateTicketDto {
  @IsString() category!: string;
  @IsIn(["P0", "P1", "P2", "P3"]) severity!: "P0" | "P1" | "P2" | "P3";
  @IsString() @MinLength(10) description!: string;
  @IsOptional() @IsString() @MaxLength(191) contextId?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() resolution?: string;
}

export class CreateTicketCommentDto { @IsString() @MinLength(2) body!: string; }
