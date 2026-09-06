ALTER TABLE `restore_jobs`
  ADD COLUMN `mode` VARCHAR(30) NOT NULL DEFAULT 'DRILL',
  ADD COLUMN `requested_by` VARCHAR(191) NOT NULL DEFAULT 'system',
  MODIFY COLUMN `approved_by` VARCHAR(191) NULL,
  ADD COLUMN `reason` VARCHAR(500) NULL,
  ADD COLUMN `target_database` VARCHAR(191) NULL,
  ADD COLUMN `approved_at` DATETIME(3) NULL;

ALTER TABLE `data_export_jobs`
  ADD COLUMN `checksum` VARCHAR(128) NULL,
  ADD COLUMN `size_bytes` BIGINT NULL,
  ADD COLUMN `error_message` VARCHAR(500) NULL;
