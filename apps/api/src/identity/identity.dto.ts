import { ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";
import { PERMISSIONS, ROLE_CODES, type PermissionCode, type RoleCode } from "../auth/permissions.js";
import type { AccountStatus } from "./identity.types.js";

/** Dữ liệu quản trị dùng để tạo người dùng và gán đúng một vai trò ban đầu. */
export class CreateUserDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{3,31}$/, { message: "Tài khoản phải có 4–32 ký tự hợp lệ." })
  username!: string;

  @IsString()
  @Length(2, 150)
  displayName!: string;

  @IsEmail()
  email!: string;

  @IsIn(ROLE_CODES)
  roleCode!: RoleCode;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  initialPassword?: string;
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
  @IsIn(["ACTIVE", "INACTIVE", "LOCKED"])
  status?: AccountStatus;
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
