-- Account security lifecycle: verification, password recovery, MFA and CSRF.
ALTER TABLE `users`
  ADD COLUMN `email_verified_at` DATETIME(3) NULL,
  ADD COLUMN `mfa_secret_encrypted` TEXT NULL,
  ADD COLUMN `mfa_enabled_at` DATETIME(3) NULL;

ALTER TABLE `auth_sessions`
  ADD COLUMN `csrf_token_hash` CHAR(64) NULL;

CREATE TABLE `account_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `type` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MFA_LOGIN') NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `account_tokens_token_hash_key`(`token_hash`),
  INDEX `account_tokens_user_id_type_expires_at_idx`(`user_id`, `type`, `expires_at`),
  INDEX `account_tokens_expires_at_consumed_at_idx`(`expires_at`, `consumed_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mfa_recovery_codes` (
  `id` VARCHAR(191) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `mfa_recovery_codes_code_hash_key`(`code_hash`),
  INDEX `mfa_recovery_codes_user_id_used_at_idx`(`user_id`, `used_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `account_tokens`
  ADD CONSTRAINT `account_tokens_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `mfa_recovery_codes`
  ADD CONSTRAINT `mfa_recovery_codes_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
