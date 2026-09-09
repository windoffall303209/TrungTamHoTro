import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Chuyển danh sách mention từ multipart JSON và giữ dữ liệu lỗi để lớp validation trả 400. */
function parseMentionedUserIds(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export class OpenDirectConversationDto {
  @IsString() @MinLength(1) @MaxLength(191) userId!: string;
}

export class OpenClassConversationDto {
  @IsString() @MinLength(1) @MaxLength(191) classId!: string;
}

export class SendChatMessageDto {
  @IsString() @MinLength(1) @MaxLength(100) clientMessageId!: string;
  @IsOptional() @IsString() @MaxLength(5_000) content?: string;
  @IsOptional() @IsString() @MaxLength(191) replyToId?: string;
  @IsOptional() @Transform(({ value }: { value: unknown }) => parseMentionedUserIds(value)) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) mentionedUserIds?: string[];
  @IsOptional() @IsIn(["ASSIGNMENT", "EXAM", "MATERIAL"]) contextType?: "ASSIGNMENT" | "EXAM" | "MATERIAL";
  @IsOptional() @IsString() @MaxLength(191) contextId?: string;
}

export class MuteConversationDto {
  @IsOptional() @IsDateString() mutedUntil?: string;
}

export class ReportChatMessageDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class BlockUserDto {
  @IsString() @MinLength(1) @MaxLength(191) userId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
