import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** Tham số truy vấn khi tải danh sách bài viết bảng tin lớp. */
export class ListFeedQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return value;
  })
  @IsBoolean()
  includeHidden?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === "" ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Nội dung văn bản khi đăng bài viết mới (có thể rỗng nếu bài viết có tệp đính kèm). */
export class CreateFeedPostDto {
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  content?: string;
}

/** Nội dung cập nhật khi chỉnh sửa bài viết trên bảng tin lớp. */
export class UpdateFeedPostDto {
  @IsString()
  @MaxLength(10_000)
  content!: string;
}

/** Hợp đồng tạo bình luận cấp 1 hoặc phản hồi con cấp 2 cho một bài viết. */
export class CreateFeedCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  replyToUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  replyToName?: string;
}

/** Tùy chọn ẩn hoặc theo dõi bài viết theo từng tài khoản người dùng. */
export class UpdateFeedPreferenceDto {
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsBoolean()
  following?: boolean;
}
