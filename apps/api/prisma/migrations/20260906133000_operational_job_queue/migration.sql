ALTER TABLE `backup_jobs`
  ADD COLUMN `requested_by` VARCHAR(191) NOT NULL DEFAULT 'system',
  ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `progress` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE `data_export_jobs`
  ADD COLUMN `requested_by` VARCHAR(191) NOT NULL DEFAULT 'system',
  ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `progress` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE `retention_jobs`
  ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `progress` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `backup_jobs_status_available_at_idx`
  ON `backup_jobs`(`status`, `available_at`);

CREATE INDEX `data_export_jobs_status_available_at_idx`
  ON `data_export_jobs`(`status`, `available_at`);

CREATE INDEX `retention_jobs_status_available_at_idx`
  ON `retention_jobs`(`status`, `available_at`);
