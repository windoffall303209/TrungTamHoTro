-- Tài khoản do quản trị viên hoặc quản lý trung tâm tạo chỉ cần tên tài khoản và mật khẩu tạm; email được bổ sung sau.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- Trạng thái mặc định của tài khoản vừa được cấp, trước khi người dùng xác thực.
ALTER TYPE "UserStatus" ADD VALUE 'PENDING' BEFORE 'PENDING_VERIFICATION';

-- Quản lý trung tâm được tạo tài khoản; API vẫn chặn họ cấp vai trò Quản trị hệ thống.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles" CROSS JOIN "permissions"
WHERE "roles"."code" = 'CENTER_MANAGER' AND "permissions"."code" = 'user:create'
ON CONFLICT DO NOTHING;
