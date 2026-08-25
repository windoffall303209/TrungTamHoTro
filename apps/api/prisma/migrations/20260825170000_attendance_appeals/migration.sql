-- CreateTable
CREATE TABLE `attendance_appeals` (
    `id` VARCHAR(191) NOT NULL,
    `session_id` VARCHAR(191) NOT NULL,
    `learner_id` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `resolution` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_appeals_session_id_status_idx`(`session_id`, `status`),
    INDEX `attendance_appeals_learner_id_created_at_idx`(`learner_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attendance_appeals` ADD CONSTRAINT `attendance_appeals_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `live_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_appeals` ADD CONSTRAINT `attendance_appeals_learner_id_fkey` FOREIGN KEY (`learner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
