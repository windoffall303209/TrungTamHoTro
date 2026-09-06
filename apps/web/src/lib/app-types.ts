/** Hợp đồng phiên, vai trò và quyền dùng chung cho RBAC phía giao diện. */
export type RoleCode = "SYSTEM_ADMIN" | "CENTER_MANAGER" | "INSTRUCTOR" | "LEARNER";

export type PermissionCode =
  | "user:view" | "user:create" | "user:update" | "user:suspend"
  | "role:view" | "role:update" | "course:view" | "course:manage"
  | "class:view" | "class:manage" | "material:view" | "material:manage"
  | "question:view" | "question:manage" | "exam:view" | "exam:manage"
  | "forum:view" | "forum:post" | "forum:moderate" | "session:view"
  | "session:manage" | "report:view" | "support:create" | "support:manage"
  | "system:configure";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  roleName: string;
  avatarUrl?: string | null;
  locale?: "vi-VN" | "en-US";
}

export interface SessionData {
  sessionId: string;
  user: SessionUser;
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
  csrfToken?: string;
}

export interface AccountProfile {
  id: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  timezone: string;
  locale: string;
  avatarUrl: string | null;
  status: "PENDING_VERIFICATION" | "ACTIVE" | "INACTIVE" | "LOCKED";
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleConnected: boolean;
  createdAt: string;
}

export interface AccountSession {
  id: string;
  current: boolean;
  currentRoleCode: RoleCode;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface IdentityUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roleCode: RoleCode;
  roleCodes: RoleCode[];
  status: "PENDING_VERIFICATION" | "ACTIVE" | "INACTIVE" | "LOCKED";
  invitationSent?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityRole {
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
  version: number;
}
