import { OmitType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** Bộ lọc hữu hạn cho hàng đợi đối soát; không nhận nội dung bài làm hoặc thông số provider. */
export class GradingOperationsQueryDto {
  @IsOptional()
  @IsIn(["RETRY_AUTHORIZED", "GENERATING", "READY", "UNCERTAIN"])
  state?: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN";
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  cursor?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export const examStates = [
  "CLAIMED",
  "GENERATING",
  "READY",
  "SAVING",
  "COMPLETED",
  "UNCERTAIN",
] as const;

export const examScopes = ["canonical", "unlinked", "broken"] as const;

/** Sinh đề có bước giữ khóa, lưu nháp và hoàn tất riêng; không đồng nhất READY với đề đã lưu. */
export class ExamOperationsQueryDto extends OmitType(
  GradingOperationsQueryDto,
  ["state"] as const,
) {
  @IsOptional()
  @IsIn(examStates)
  state?: (typeof examStates)[number];
  @IsOptional()
  @IsIn(examScopes)
  scope?: (typeof examScopes)[number];
}

/** Bằng chứng vận hành bắt buộc trước khi mở lại một claim có kết quả chưa xác định. */
export class ReconcileExamNotProcessedDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @IsString()
  @MinLength(8)
  @MaxLength(191)
  evidenceReference!: string;
  @IsString()
  @MinLength(20)
  @MaxLength(2_000)
  evidenceNote!: string;
  @IsISO8601({ strict: true })
  checkedAt!: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  providerRequestId?: string;
}

/** Bằng chứng cùng mốc cập nhật cho claim AI lưu trong bảng có updatedAt làm khóa CAS. */
export class ReconcileAiOperationNotProcessedDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
  @IsString()
  @MinLength(8)
  @MaxLength(191)
  evidenceReference!: string;
  @IsString()
  @MinLength(20)
  @MaxLength(2_000)
  evidenceNote!: string;
  @IsISO8601({ strict: true })
  checkedAt!: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  providerRequestId?: string;
}
