CREATE TABLE `attendance_intervals` (
  `id` VARCHAR(191) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `learner_id` VARCHAR(191) NOT NULL,
  `joined_at` DATETIME(3) NOT NULL,
  `left_at` DATETIME(3) NULL,
  `source` VARCHAR(30) NOT NULL,
  `provider_participant_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `attendance_intervals_session_id_learner_id_joined_at_idx`(`session_id`, `learner_id`, `joined_at`),
  INDEX `attendance_intervals_provider_participant_id_idx`(`provider_participant_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `attendance_intervals_record_fkey` FOREIGN KEY (`session_id`, `learner_id`) REFERENCES `attendance_records`(`session_id`, `learner_id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `attendance_intervals` (`id`, `session_id`, `learner_id`, `joined_at`, `left_at`, `source`)
SELECT CONCAT('interval-legacy-', REPLACE(UUID(), '-', '')), `session_id`, `learner_id`, `joined_at`, `left_at`, 'LEGACY'
FROM `attendance_records`
WHERE `joined_at` IS NOT NULL;
