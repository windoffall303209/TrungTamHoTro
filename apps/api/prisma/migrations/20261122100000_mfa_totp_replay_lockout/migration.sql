-- Chống phát lại mã TOTP (lưu bước thời gian đã dùng) và khóa tạm sau nhiều lần nhập sai.
ALTER TABLE "users" ADD COLUMN "mfa_last_used_step" INTEGER,
ADD COLUMN "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "mfa_locked_until" TIMESTAMP(3);
