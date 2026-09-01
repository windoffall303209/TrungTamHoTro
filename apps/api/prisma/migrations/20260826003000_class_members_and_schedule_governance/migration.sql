ALTER TABLE `class_instructors`
  ADD COLUMN `role` ENUM('PRIMARY', 'CO_INSTRUCTOR') NOT NULL DEFAULT 'CO_INSTRUCTOR',
  ADD COLUMN `assigned_by` VARCHAR(191) NOT NULL DEFAULT 'usr-manager';

CREATE TABLE `class_instructor_history` (
  `id` VARCHAR(191) NOT NULL,
  `class_id` VARCHAR(191) NOT NULL,
  `instructor_id` VARCHAR(191) NOT NULL,
  `role` ENUM('PRIMARY', 'CO_INSTRUCTOR') NOT NULL,
  `action` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `actor_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `class_instructor_history_class_id_created_at_idx` (`class_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `class_instructor_history_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `learning_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `class_enrollments`
  ADD COLUMN `source` VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `removal_reason` VARCHAR(500) NULL,
  ADD COLUMN `removed_at` DATETIME(3) NULL;

CREATE TABLE `class_enrollment_history` (
  `id` VARCHAR(191) NOT NULL,
  `class_id` VARCHAR(191) NOT NULL,
  `learner_id` VARCHAR(191) NOT NULL,
  `action` VARCHAR(30) NOT NULL,
  `source` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `actor_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `class_enrollment_history_class_id_created_at_idx` (`class_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `class_enrollment_history_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `learning_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `live_sessions`
  ADD COLUMN `timezone` VARCHAR(80) NOT NULL DEFAULT 'Asia/Bangkok',
  ADD COLUMN `change_reason` VARCHAR(500) NULL,
  ADD COLUMN `cancellation_reason` VARCHAR(500) NULL;
