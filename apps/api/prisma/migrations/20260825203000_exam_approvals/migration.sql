ALTER TABLE `exams` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

CREATE TABLE `exam_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `exam_id` VARCHAR(191) NOT NULL,
    `reviewer_id` VARCHAR(191) NOT NULL,
    `exam_version` INTEGER NOT NULL,
    `decision` VARCHAR(30) NOT NULL,
    `review_note` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `exam_approvals_exam_id_created_at_idx`(`exam_id`, `created_at`),
    INDEX `exam_approvals_reviewer_id_idx`(`reviewer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `exam_approvals`
    ADD CONSTRAINT `exam_approvals_exam_id_fkey` FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `exam_approvals_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
