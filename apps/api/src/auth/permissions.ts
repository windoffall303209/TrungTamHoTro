import {
  PERMISSIONS,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
} from "@wind-of-fall/contracts";

export { PERMISSIONS, ROLE_CODES };
export type { PermissionCode, RoleCode };

/** Ma trận quyền mặc định khi khởi tạo hệ thống; quyền thực tế của phiên vẫn đọc từ cơ sở dữ liệu. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SYSTEM_ADMIN: PERMISSIONS.filter((permission) => !["question:manage", "exam:manage"].includes(permission)),
  CENTER_MANAGER: [
    "user:view", "user:create", "user:update", "user:suspend", "course:view", "course:manage", "class:view", "class:manage",
    "material:view", "material:manage", "question:view", "exam:view", "forum:view", "forum:moderate", "session:view",
    "report:view", "support:manage",
  ],
  INSTRUCTOR: [
    "course:view", "class:view", "material:view", "material:manage", "question:view",
    "question:manage", "exam:view", "exam:manage", "forum:view", "forum:post",
    "forum:moderate", "session:view", "session:manage", "report:view", "support:create",
  ],
  LEARNER: [
    "course:view", "class:view", "material:view", "exam:view", "forum:view",
    "forum:post", "session:view", "support:create",
  ],
};
