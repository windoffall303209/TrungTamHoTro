import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength,
} from "class-validator";
import type { LearningQuestion } from "./learning.types.js";

export class CreateCourseDto {
  @IsString() @MinLength(2) @MaxLength(50) code!: string;
  @IsString() @MinLength(3) @MaxLength(200) name!: string;
  @IsString() @MinLength(10) description!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) outcomes!: string[];
}

export class CreateClassDto {
  @IsString() courseId!: string;
  @IsString() @MinLength(2) code!: string;
  @IsString() @MinLength(3) name!: string;
  @IsString() term!: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsInt() @Min(1) @Max(1000) capacity!: number;
}

export class AssignUserDto { @IsString() @IsNotEmpty() userId!: string; }

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

export class CreateExamDto {
  @IsString() classId!: string;
  @IsString() @MinLength(3) title!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) questionIds!: string[];
  @IsInt() @Min(1) durationMinutes!: number;
  @IsNumber() @Min(1) totalScore!: number;
  @IsDateString() openAt!: string;
  @IsDateString() closeAt!: string;
  @IsInt() @Min(1) @Max(10) attemptLimit!: number;
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

export class CreateReportDto {
  @IsIn(["TOPIC", "POST"]) targetType!: "TOPIC" | "POST";
  @IsString() targetId!: string;
  @IsString() @MinLength(2) reason!: string;
  @IsString() @MinLength(3) details!: string;
}

export class ResolveReportDto {
  @IsIn(["RESOLVED", "REJECTED"]) status!: "RESOLVED" | "REJECTED";
  @IsString() @MinLength(3) resolution!: string;
}

export class CreateSessionDto {
  @IsString() @MinLength(3) title!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsIn(["GOOGLE_MEET", "ZOOM", "JITSI"]) provider!: "GOOGLE_MEET" | "ZOOM" | "JITSI";
}

export class TransitionSessionDto { @IsIn(["LIVE", "COMPLETED", "CANCELLED"]) status!: "LIVE" | "COMPLETED" | "CANCELLED"; }

export class UpdateAttendanceDto {
  @IsString() learnerId!: string;
  @IsIn(["PRESENT", "LATE", "ABSENT", "EXCUSED"]) status!: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
  @IsInt() @Min(0) attendedMinutes!: number;
  @IsString() @MinLength(3) adjustmentReason!: string;
}

export class AttachRecordingDto { @IsUrl({ require_tld: false }) recordingUrl!: string; }
export class CreateAttendanceAppealDto { @IsString() @MinLength(10) reason!: string; }

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
