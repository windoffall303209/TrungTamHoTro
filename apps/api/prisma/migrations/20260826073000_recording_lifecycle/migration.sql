ALTER TABLE `live_sessions`
  ADD COLUMN `recording_status` VARCHAR(20) NOT NULL DEFAULT 'NONE',
  ADD COLUMN `recording_ready_at` DATETIME(3) NULL,
  ADD COLUMN `recording_expires_at` DATETIME(3) NULL,
  ADD COLUMN `recording_error` VARCHAR(500) NULL;

UPDATE `live_sessions`
SET `recording_status` = 'READY',
    `recording_ready_at` = COALESCE(`updated_at`, CURRENT_TIMESTAMP(3)),
    `recording_expires_at` = DATE_ADD(COALESCE(`updated_at`, CURRENT_TIMESTAMP(3)), INTERVAL 90 DAY)
WHERE `recording_url` IS NOT NULL;
