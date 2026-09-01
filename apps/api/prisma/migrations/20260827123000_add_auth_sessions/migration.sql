CREATE TABLE `auth_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `current_role_code` VARCHAR(50) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `auth_sessions_token_hash_key`(`token_hash`),
  INDEX `auth_sessions_user_id_expires_at_idx`(`user_id`, `expires_at`),
  INDEX `auth_sessions_expires_at_revoked_at_idx`(`expires_at`, `revoked_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
