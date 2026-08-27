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
  name: string;
  email: string;
  roleName: string;
}

export interface SessionData {
  sessionId: string;
  user: SessionUser;
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
}

export interface IdentityUser {
  id: string;
  displayName: string;
  email: string;
  roleCode: RoleCode;
  status: "ACTIVE" | "INACTIVE" | "LOCKED";
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
