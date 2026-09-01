ALTER TABLE `forum_topics`
  ADD COLUMN `status` ENUM('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'PUBLISHED';

ALTER TABLE `content_reports`
  MODIFY `status` ENUM('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
  ADD COLUMN `assigned_to_id` VARCHAR(191) NULL,
  ADD COLUMN `escalation_level` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resolved_at` DATETIME(3) NULL,
  ADD COLUMN `appeal_reason` TEXT NULL,
  ADD COLUMN `appealed_at` DATETIME(3) NULL;

CREATE TABLE `moderation_actions` (
  `id` VARCHAR(191) NOT NULL,
  `report_id` VARCHAR(191) NOT NULL,
  `actor_id` VARCHAR(191) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `reason` TEXT NOT NULL,
  `previous_status` ENUM('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED') NOT NULL,
  `next_status` ENUM('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED') NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `moderation_actions_report_id_created_at_idx` (`report_id`, `created_at`),
  INDEX `moderation_actions_actor_id_created_at_idx` (`actor_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `moderation_actions_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `content_reports` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
