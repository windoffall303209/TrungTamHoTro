import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

/** Một tiêu chí rubric và số điểm tối đa dùng khi tạo bài tập. */
export class RubricCriterionDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(500) description!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(1000) maxPoints!: number;
}

/** Hợp đồng tạo bài tập gồm lịch hạn, thang điểm và rubric. */
export class CreateAssignmentDto {
  @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @IsString() @MinLength(10) @MaxLength(5000) description!: string;
  @IsString() @MinLength(5) @MaxLength(10_000) instructions!: string;
  @IsDateString() dueAt!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(1000) maxScore!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  rubric!: RubricCriterionDto[];
}

export class SubmitAssignmentDto {
  @IsOptional() @IsString() @MaxLength(20_000) content?: string;
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

/** Hợp đồng sửa bài nháp giữ khóa phiên bản lạc quan. */
export class UpdateAssignmentDto extends CreateAssignmentDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

/** Hợp đồng gia hạn bài đã công bố và lý do bắt buộc. */
export class ExtendAssignmentDto {
  @IsDateString() dueAt!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}

/** Hợp đồng đóng bài sớm có lý do và khóa phiên bản. */
export class CloseAssignmentDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}

/** Khóa phiên bản cho thao tác sửa tệp bài nộp. */
export class SubmissionRevisionQueryDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class RubricScoreDto {
  @IsString() criterionId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) score!: number;
}

/** Điểm theo từng tiêu chí cùng phản hồi chung của giảng viên. */
export class GradeAssignmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RubricScoreDto)
  rubricScores!: RubricScoreDto[];
  @IsString() @MinLength(3) @MaxLength(5000) feedback!: string;
  @IsInt() @Min(1) expectedSubmissionRevision!: number;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  correctionReason?: string;
}

/** Chỉ nhận phiên bản và ngôn ngữ; bài làm, rubric và model phải lấy từ hệ thống. */
export class GradingAiRequestDto {
  @IsInt() @Min(1) @Max(2_147_483_647) expectedSubmissionRevision!: number;
  @IsIn(["VI", "EN", "BILINGUAL"]) language!: "VI" | "EN" | "BILINGUAL";
}

/** Chuẩn hóa riêng số nguyên dạng chuỗi trong query đọc trạng thái, không nhận ép kiểu tùy ý. */
export class GradingAiStatusQueryDto extends GradingAiRequestDto {
  @Transform(({ value }: { value: unknown }) => typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  declare expectedSubmissionRevision: number;
}

export class CreateAnnouncementDto {
  @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @IsString() @MinLength(5) @MaxLength(10_000) body!: string;
}

export class AcademicQueryDto {
  @IsOptional() @IsString() @MaxLength(191) classId?: string;
}
