import type { IsoDateTimeString } from "./primitives.js";

/** Danh mục vai trò ổn định được dùng xuyên suốt API, giao diện và dữ liệu seed. */
export const ROLE_CODES = [
  "SYSTEM_ADMIN",
  "CENTER_MANAGER",
  "INSTRUCTOR",
  "LEARNER",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/** Danh mục quyền theo tài nguyên; PermissionGuard đối chiếu các mã này trên từng route. */
export const PERMISSIONS = [
  "user:view",
  "user:create",
  "user:update",
  "user:suspend",
  "role:view",
  "role:update",
  "course:view",
  "course:manage",
  "class:view",
  "class:manage",
  "material:view",
  "material:manage",
  "question:view",
  "question:manage",
  "exam:view",
  "exam:manage",
  "forum:view",
  "forum:post",
  "forum:moderate",
  "session:view",
  "session:manage",
  "report:view",
  "support:create",
  "support:manage",
  "system:configure",
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

/** Trạng thái vòng đời tài khoản dùng chung giữa API và giao diện quản trị. */
export const ACCOUNT_STATUSES = [
  "PENDING",
  "PENDING_VERIFICATION",
  "ACTIVE",
  "INACTIVE",
  "LOCKED",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type LocaleCode = "vi-VN" | "en-US";

/** Thông tin rút gọn người dùng gắn trong phiên đăng nhập hiện hành. */
export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roleName: string;
  avatarUrl?: string | null;
  locale?: LocaleCode;
}

/** Hợp đồng phiên xác thực trả về từ API sau đăng nhập hoặc làm mới phiên. */
export interface AuthenticatedSession {
  sessionId: string;
  user: SessionUser;
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
}

/** Hợp đồng phiên mở rộng phía client kèm CSRF token không nhạy cảm để gửi header bảo vệ. */
export interface SessionData extends AuthenticatedSession {
  csrfToken?: string;
}

/** Hồ sơ tài khoản cá nhân hiển thị và chỉnh sửa trong màn quản lý tài khoản. */
export interface AccountProfile {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string;
  timezone: string;
  locale: string;
  avatarUrl: string | null;
  status: AccountStatus;
  emailVerifiedAt: IsoDateTimeString | null;
  mfaEnabled: boolean;
  mfaRecoveryCodesRemaining: number;
  hasPassword: boolean;
  createdAt: IsoDateTimeString;
}

/** Thông tin phiên đăng nhập hoạt động của tài khoản hiện hành. */
export interface AccountSession {
  id: string;
  current: boolean;
  currentRoleCode: RoleCode;
  ipAddress: string;
  userAgent: string;
  createdAt: IsoDateTimeString;
  lastSeenAt: IsoDateTimeString;
  expiresAt: IsoDateTimeString;
}

/** View model người dùng quản trị, cố ý không chứa mật khẩu hay token. */
export interface IdentityUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  roleCode: RoleCode;
  roleCodes: RoleCode[];
  status: AccountStatus;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** Vai trò cùng tập quyền và version phục vụ màn hình cấu hình RBAC. */
export interface IdentityRole {
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
  version: number;
}

/** Ảnh hưởng phải được xử lý trước khi đổi vai trò hoặc trạng thái tài khoản. */
export interface IdentityChangeImpact {
  userId: string;
  currentRoleCode: RoleCode;
  currentStatus: AccountStatus;
  nextRoleCode: RoleCode;
  nextStatus: AccountStatus;
  token: string;
  requiresHandoff: boolean;
  activeSessions: number;
  classes: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    assignmentRole: "PRIMARY" | "CO_INSTRUCTOR";
  }>;
  openWork: {
    regrades: number;
    interventions: number;
    supportTickets: number;
    upcomingSessions: number;
  };
}
