/** Danh mục vai trò ổn định được dùng xuyên suốt API, giao diện và dữ liệu seed. */
export const ROLE_CODES = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] as const;

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

/** Ma trận quyền mặc định khi khởi tạo hệ thống; quyền thực tế của phiên vẫn đọc từ cơ sở dữ liệu. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SYSTEM_ADMIN: [...PERMISSIONS],
  CENTER_MANAGER: [
    "user:view", "course:view", "course:manage", "class:view", "class:manage",
    "material:view", "exam:view", "forum:view", "forum:moderate", "session:view",
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
