ALTER TABLE `live_sessions`
  ADD COLUMN `requested_provider` VARCHAR(50) NULL,
  ADD COLUMN `fallback_used` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `provisioning_attempts` INTEGER NOT NULL DEFAULT 1;

UPDATE `live_sessions` SET `requested_provider` = `provider` WHERE `requested_provider` IS NULL;

ALTER TABLE `live_sessions` MODIFY `requested_provider` VARCHAR(50) NOT NULL;
