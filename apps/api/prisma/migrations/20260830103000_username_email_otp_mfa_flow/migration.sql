ALTER TABLE `users`
  MODIFY `status` ENUM('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `username` VARCHAR(32) NULL AFTER `id`;

UPDATE `users`
SET `username` = LOWER(CONCAT('user_', LEFT(SHA2(CONCAT(`id`, ':', `email`), 256), 16)))
WHERE `username` IS NULL;

UPDATE `users`
SET `email_verified_at` = COALESCE(`email_verified_at`, CURRENT_TIMESTAMP)
WHERE `status` <> 'PENDING_VERIFICATION';

ALTER TABLE `users`
  MODIFY `username` VARCHAR(32) NOT NULL,
  ADD UNIQUE INDEX `users_username_key` (`username`);

ALTER TABLE `account_tokens`
  MODIFY `type` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MFA_LOGIN', 'MFA_DISABLE') NOT NULL,
  ADD COLUMN `code_hash` CHAR(64) NULL AFTER `token_hash`,
  ADD COLUMN `failed_attempts` INTEGER NOT NULL DEFAULT 0 AFTER `code_hash`;
