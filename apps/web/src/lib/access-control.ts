import type { PermissionCode, SessionData } from "./app-types";

/** Kiểm tra một quyền chính xác trong snapshot quyền của phiên. */
export function hasPermission(
  session: Pick<SessionData, "permissions">,
  permission: PermissionCode,
): boolean {
  return session.permissions.includes(permission);
}

/** Trả true khi phiên có ít nhất một quyền trong danh sách. */
export function hasAnyPermission(
  session: Pick<SessionData, "permissions">,
  permissions: readonly PermissionCode[],
): boolean {
  return permissions.some((permission) => hasPermission(session, permission));
}

/** Trả true khi phiên có đầy đủ mọi quyền được yêu cầu. */
export function hasEveryPermission(
  session: Pick<SessionData, "permissions">,
  permissions: readonly PermissionCode[],
): boolean {
  return permissions.every((permission) => hasPermission(session, permission));
}
