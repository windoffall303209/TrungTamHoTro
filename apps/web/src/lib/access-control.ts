import type { PermissionCode, SessionData } from "./app-types";

export function hasPermission(
  session: Pick<SessionData, "permissions">,
  permission: PermissionCode,
): boolean {
  return session.permissions.includes(permission);
}

export function hasAnyPermission(
  session: Pick<SessionData, "permissions">,
  permissions: readonly PermissionCode[],
): boolean {
  return permissions.some((permission) => hasPermission(session, permission));
}

export function hasEveryPermission(
  session: Pick<SessionData, "permissions">,
  permissions: readonly PermissionCode[],
): boolean {
  return permissions.every((permission) => hasPermission(session, permission));
}
