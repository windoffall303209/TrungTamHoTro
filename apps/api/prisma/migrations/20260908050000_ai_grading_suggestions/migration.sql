CREATE TABLE `ai_grading_suggestions` (
  `id` VARCHAR(191) NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `owner_id` VARCHAR(191) NOT NULL,
  `submission_id` VARCHAR(191) NOT NULL,
  `context_hash` CHAR(64) NOT NULL,
  `language` VARCHAR(16) NOT NULL,
  `state` ENUM('GENERATING', 'READY', 'UNCERTAIN') NOT NULL DEFAULT 'GENERATING',
  `result` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_grading_suggestions_fingerprint_key` (`fingerprint`),
  INDEX `ai_grading_suggestions_owner_id_submission_id_created_at_idx` (`owner_id`, `submission_id`, `created_at`),
  CONSTRAINT `ai_grading_suggestions_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ai_grading_suggestions_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
