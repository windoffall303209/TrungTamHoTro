import { ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, Length } from "class-validator";
import { PERMISSIONS, ROLE_CODES, type PermissionCode, type RoleCode } from "../auth/permissions.js";
import type { AccountStatus } from "./identity.types.js";

export class CreateUserDto {
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

export class UpdateRolePermissionsDto {
  @IsIn(ROLE_CODES)
  roleCode!: RoleCode;

  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: PermissionCode[];
}

export class UpdatePermissionsBodyDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: PermissionCode[];
}
