ALTER TABLE `live_sessions`
  ADD COLUMN `attendance_locked_at` DATETIME(3) NULL,
  ADD COLUMN `attendance_locked_by_id` VARCHAR(191) NULL;

ALTER TABLE `attendance_records`
  ADD COLUMN `provider_participant_id` VARCHAR(191) NULL,
  ADD COLUMN `provider_snapshot` JSON NULL;

CREATE UNIQUE INDEX `attendance_records_session_id_provider_participant_id_key`
  ON `attendance_records`(`session_id`, `provider_participant_id`);

CREATE INDEX `live_sessions_attendance_locked_by_id_idx`
  ON `live_sessions`(`attendance_locked_by_id`);

ALTER TABLE `live_sessions`
  ADD CONSTRAINT `live_sessions_attendance_locked_by_id_fkey`
  FOREIGN KEY (`attendance_locked_by_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
