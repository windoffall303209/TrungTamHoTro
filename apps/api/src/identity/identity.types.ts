import type { PermissionCode, RoleCode } from "../auth/permissions.js";

export type AccountStatus = "PENDING_VERIFICATION" | "ACTIVE" | "INACTIVE" | "LOCKED";

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

export interface IdentityRole {
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
  version: number;
}

export interface IdentityAuditEvent {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  summary: string;
  createdAt: string;
}
