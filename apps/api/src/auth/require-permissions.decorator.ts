import { SetMetadata } from "@nestjs/common";
import type { PermissionCode } from "./permissions.js";

export const REQUIRED_PERMISSIONS_KEY = "required_permissions";

export const RequirePermissions = (...permissions: PermissionCode[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

