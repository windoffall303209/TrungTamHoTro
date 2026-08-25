-- AlterTable
ALTER TABLE `exam_attempts` ADD COLUMN `grade_published_at` DATETIME(3) NULL;

-- Backfill published objective/manual grades created before this workflow.
UPDATE `exam_attempts`
SET `grade_published_at` = COALESCE(`submitted_at`, `started_at`)
WHERE `status` = 'GRADED' AND `grade_published_at` IS NULL;

-- CreateTable
CREATE TABLE `regrade_requests` (
    `id` VARCHAR(191) NOT NULL,
    `attempt_id` VARCHAR(191) NOT NULL,
    `learner_id` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `resolution` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `regrade_requests_attempt_id_status_idx`(`attempt_id`, `status`),
    INDEX `regrade_requests_learner_id_created_at_idx`(`learner_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `regrade_requests` ADD CONSTRAINT `regrade_requests_attempt_id_fkey` FOREIGN KEY (`attempt_id`) REFERENCES `exam_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `regrade_requests` ADD CONSTRAINT `regrade_requests_learner_id_fkey` FOREIGN KEY (`learner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
