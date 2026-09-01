CREATE TABLE `progress_interventions` (
  `id` VARCHAR(191) NOT NULL,
  `class_id` VARCHAR(191) NOT NULL,
  `learner_id` VARCHAR(191) NOT NULL,
  `owner_id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `notes` TEXT NULL,
  `due_at` DATETIME(3) NOT NULL,
  `status` ENUM('OPEN', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `progress_interventions_class_id_learner_id_status_idx` (`class_id`, `learner_id`, `status`),
  INDEX `progress_interventions_owner_id_due_at_idx` (`owner_id`, `due_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `report_runs` (
  `id` VARCHAR(191) NOT NULL,
  `report_type` VARCHAR(50) NOT NULL,
  `definition_version` VARCHAR(30) NOT NULL,
  `timezone` VARCHAR(80) NOT NULL,
  `filters` JSON NOT NULL,
  `result` JSON NOT NULL,
  `requested_by_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `report_runs_report_type_created_at_idx` (`report_type`, `created_at`),
  INDEX `report_runs_requested_by_id_created_at_idx` (`requested_by_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `report_exports` (
  `id` VARCHAR(191) NOT NULL,
  `report_run_id` VARCHAR(191) NOT NULL,
  `format` VARCHAR(20) NOT NULL,
  `status` ENUM('QUEUED', 'COMPLETED', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'QUEUED',
  `file_name` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(1000) NULL,
  `size_bytes` BIGINT NULL,
  `error_message` TEXT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `requested_by_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `report_exports_requested_by_id_created_at_idx` (`requested_by_id`, `created_at`),
  INDEX `report_exports_status_expires_at_idx` (`status`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `report_exports_report_run_id_fkey` FOREIGN KEY (`report_run_id`) REFERENCES `report_runs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
