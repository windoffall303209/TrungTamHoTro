ALTER TABLE `backup_jobs`
  ADD COLUMN `object_key` VARCHAR(500) NULL,
  ADD COLUMN `error_message` VARCHAR(500) NULL;
