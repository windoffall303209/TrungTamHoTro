ALTER TABLE `progress_interventions`
  MODIFY COLUMN `status` ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
  ADD COLUMN `created_by_id` VARCHAR(191) NULL,
  ADD COLUMN `outcome` TEXT NULL,
  ADD COLUMN `cancellation_reason` VARCHAR(1000) NULL,
  ADD COLUMN `accepted_at` DATETIME(3) NULL,
  ADD COLUMN `handoff_history` JSON NOT NULL DEFAULT ('[]');

UPDATE `progress_interventions`
SET `created_by_id` = `owner_id`
WHERE `created_by_id` IS NULL;

ALTER TABLE `progress_interventions`
  MODIFY COLUMN `created_by_id` VARCHAR(191) NOT NULL;
