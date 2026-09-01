ALTER TABLE `exams`
  ADD COLUMN `shuffle_questions` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `random_seed` VARCHAR(100) NULL;

CREATE TABLE `grade_history` (
  `id` VARCHAR(191) NOT NULL,
  `attempt_id` VARCHAR(191) NOT NULL,
  `grader_id` VARCHAR(191) NOT NULL,
  `previous_score` DECIMAL(8,2) NULL,
  `next_score` DECIMAL(8,2) NOT NULL,
  `reason` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `grade_history_attempt_id_created_at_idx` (`attempt_id`, `created_at`),
  CONSTRAINT `grade_history_attempt_id_fkey` FOREIGN KEY (`attempt_id`) REFERENCES `exam_attempts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
