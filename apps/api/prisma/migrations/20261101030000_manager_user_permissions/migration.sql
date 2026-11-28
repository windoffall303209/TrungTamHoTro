-- Bổ sung quyền chỉnh sửa vai trò và trạng thái tài khoản cho quản lý trung tâm hiện có.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles" CROSS JOIN "permissions"
WHERE "roles"."code" = 'CENTER_MANAGER'
  AND "permissions"."code" IN ('user:update', 'user:suspend')
ON CONFLICT DO NOTHING;
