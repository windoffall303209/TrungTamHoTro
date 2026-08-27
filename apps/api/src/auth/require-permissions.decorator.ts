import { SetMetadata } from "@nestjs/common";
import type { PermissionCode } from "./permissions.js";

export const REQUIRED_PERMISSIONS_KEY = "required_permissions";
export const AUTHENTICATION_REQUIRED_KEY = "authentication_required";

export const RequirePermissions = (...permissions: PermissionCode[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const RequireAuthentication = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATION_REQUIRED_KEY, true);
