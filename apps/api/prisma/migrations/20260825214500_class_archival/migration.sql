ALTER TABLE `learning_classes`
  ADD COLUMN `close_reason` VARCHAR(500) NULL,
  ADD COLUMN `archive_policy` VARCHAR(50) NULL,
  ADD COLUMN `closed_at` DATETIME(3) NULL,
  ADD COLUMN `archived_at` DATETIME(3) NULL;
