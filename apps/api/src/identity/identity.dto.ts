import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform, type TransformFnParams } from "class-transformer";
import {
  PERMISSIONS,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
} from "../auth/permissions.js";
import type { AccountStatus } from "./identity.types.js";

/** Giới hạn phân trang và độ dài tìm kiếm trước khi truy vấn database. */
export class UserListQueryDto {
  @IsOptional() @IsString() @MaxLength(200)
  query?: string;
  @Transform(({ value }: TransformFnParams) => Number(value)) @IsInt() @Min(1) @Max(10000)
  page = 1;
  @Transform(({ value }: TransformFnParams) => Number(value)) @IsInt() @Min(1) @Max(50)
  pageSize = 20;
}

/** Chuẩn hóa query vai trò từ mảng hoặc chuỗi phân tách bằng dấu phẩy. */
function normalizeRoleCodes(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value as unknown[] : String(value).split(",");
  return values.map((item) => String(item).trim()).filter(Boolean);
}

/** Dữ liệu tạo tài khoản: tên đăng nhập, mật khẩu tạm và vai trò ban đầu; hồ sơ được người dùng bổ sung sau. */
export class CreateUserDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{3,31}$/, {
    message: "Tài khoản phải có 4–32 ký tự hợp lệ.",
  })
  username!: string;

  @IsIn(ROLE_CODES)
  roleCode!: RoleCode;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(ROLE_CODES, { each: true })
  roleCodes?: RoleCode[];

  @IsString()
  @Length(8, 128, { message: "Mật khẩu tạm thời phải có từ 8 đến 128 ký tự." })
  initialPassword!: string;
}

/** Các thuộc tính tài khoản quản trị viên được phép thay đổi. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  displayName?: string;

  @IsOptional()
  @IsIn(ROLE_CODES)
  roleCode?: RoleCode;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(ROLE_CODES, { each: true })
  roleCodes?: RoleCode[];

  @IsOptional()
  @IsIn(["ACTIVE", "INACTIVE", "LOCKED"])
  status?: AccountStatus;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  impactToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  handoffUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  handoffReason?: string;
}

/** Trạng thái đích dùng để xem trước ảnh hưởng trước khi lưu. */
export class UserChangeImpactQueryDto {
  @IsOptional() @IsIn(ROLE_CODES) roleCode?: RoleCode;
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => normalizeRoleCodes(value as unknown))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(ROLE_CODES, { each: true })
  roleCodes?: RoleCode[];
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE", "LOCKED"]) status?: AccountStatus;
}

/** Hợp đồng nội bộ gồm vai trò và tập quyền duy nhất đã kiểm tra theo danh mục. */
export class UpdateRolePermissionsDto {
  @IsIn(ROLE_CODES)
  roleCode!: RoleCode;

  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: PermissionCode[];
}

/** Body cập nhật quyền; roleCode được lấy từ tham số đường dẫn. */
export class UpdatePermissionsBodyDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: PermissionCode[];
}
