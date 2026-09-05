import type { PermissionCode, RoleCode } from "../auth/permissions.js";

/** Trạng thái vòng đời tài khoản được dùng chung giữa DTO, service và giao diện quản trị. */
export type AccountStatus = "PENDING_VERIFICATION" | "ACTIVE" | "INACTIVE" | "LOCKED";

/** View model người dùng quản trị, cố ý không chứa mật khẩu hay token. */
export interface IdentityUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roleCode: RoleCode;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

/** Vai trò cùng tập quyền và version phục vụ màn hình cấu hình RBAC. */
export interface IdentityRole {
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
  version: number;
}

/** Dòng nhật ký rút gọn mô tả ai đã thay đổi đối tượng danh tính nào. */
export interface IdentityAuditEvent {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  summary: string;
  createdAt: string;
}
