CREATE TABLE `assignments` (
  `id` VARCHAR(191) NOT NULL,
  `class_id` VARCHAR(191) NOT NULL,
  `created_by_id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `instructions` TEXT NOT NULL,
  `due_at` DATETIME(3) NOT NULL,
  `max_score` DECIMAL(8,2) NOT NULL,
  `rubric` JSON NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `assignments_class_id_status_due_at_idx`(`class_id`, `status`, `due_at`),
  INDEX `assignments_created_by_id_idx`(`created_by_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assignment_submissions` (
  `id` VARCHAR(191) NOT NULL,
  `assignment_id` VARCHAR(191) NOT NULL,
  `learner_id` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `status` ENUM('SUBMITTED', 'GRADED') NOT NULL DEFAULT 'SUBMITTED',
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `score` DECIMAL(8,2) NULL,
  `rubric_scores` JSON NULL,
  `feedback` TEXT NULL,
  `graded_by` VARCHAR(191) NULL,
  `graded_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `assignment_submissions_assignment_id_learner_id_key`(`assignment_id`, `learner_id`),
  INDEX `assignment_submissions_learner_id_status_idx`(`learner_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `class_announcements` (
  `id` VARCHAR(191) NOT NULL,
  `class_id` VARCHAR(191) NOT NULL,
  `author_id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `class_announcements_class_id_published_at_idx`(`class_id`, `published_at`),
  INDEX `class_announcements_author_id_idx`(`author_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `assignments` ADD CONSTRAINT `assignments_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `learning_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `assignment_submissions` ADD CONSTRAINT `assignment_submissions_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `assignment_submissions` ADD CONSTRAINT `assignment_submissions_learner_id_fkey` FOREIGN KEY (`learner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `class_announcements` ADD CONSTRAINT `class_announcements_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `learning_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `class_announcements` ADD CONSTRAINT `class_announcements_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
