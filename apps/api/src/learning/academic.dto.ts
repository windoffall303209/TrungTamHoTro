import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

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
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RubricCriterionDto)
  rubric!: RubricCriterionDto[];
}

export class SubmitAssignmentDto { @IsOptional() @IsString() @MaxLength(20_000) content?: string; }

export class RubricScoreDto {
  @IsString() criterionId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) score!: number;
}

/** Điểm theo từng tiêu chí cùng phản hồi chung của giảng viên. */
export class GradeAssignmentDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RubricScoreDto)
  rubricScores!: RubricScoreDto[];
  @IsString() @MinLength(3) @MaxLength(5000) feedback!: string;
}

export class CreateAnnouncementDto {
  @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @IsString() @MinLength(5) @MaxLength(10_000) body!: string;
}

export class AcademicQueryDto {
  @IsOptional() @IsString() @MaxLength(191) classId?: string;
}
