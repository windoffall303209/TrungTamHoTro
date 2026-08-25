CREATE TABLE `system_setting_revisions` (
  `id` VARCHAR(191) NOT NULL, `key` VARCHAR(100) NOT NULL, `value` JSON NOT NULL,
  `version` INTEGER NOT NULL, `effective_at` DATETIME(3) NOT NULL,
  `updated_by` VARCHAR(191) NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `system_setting_revisions_key_version_key` (`key`, `version`),
  INDEX `system_setting_revisions_key_effective_at_idx` (`key`, `effective_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `retention_policies` (
  `id` VARCHAR(191) NOT NULL, `category` VARCHAR(100) NOT NULL, `version` INTEGER NOT NULL,
  `retention_days` INTEGER NOT NULL, `action` VARCHAR(20) NOT NULL, `approved_by` VARCHAR(191) NOT NULL,
  `effective_at` DATETIME(3) NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `retention_policies_category_version_key` (`category`, `version`),
  INDEX `retention_policies_category_effective_at_idx` (`category`, `effective_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `legal_holds` (
  `id` VARCHAR(191) NOT NULL, `category` VARCHAR(100) NOT NULL, `reason` VARCHAR(500) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true, `created_by` VARCHAR(191) NOT NULL,
  `released_at` DATETIME(3) NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `legal_holds_category_active_idx` (`category`, `active`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `retention_jobs` (
  `id` VARCHAR(191) NOT NULL, `policy_id` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING','RUNNING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  `affected_rows` INTEGER NOT NULL DEFAULT 0, `skipped_rows` INTEGER NOT NULL DEFAULT 0,
  `evidence` JSON NULL, `requested_by` VARCHAR(191) NOT NULL, `approved_by` VARCHAR(191) NOT NULL,
  `completed_at` DATETIME(3) NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `retention_jobs_status_created_at_idx` (`status`, `created_at`), PRIMARY KEY (`id`),
  CONSTRAINT `retention_jobs_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `retention_policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_alerts` (
  `id` VARCHAR(191) NOT NULL, `fingerprint` VARCHAR(191) NOT NULL, `service_name` VARCHAR(100) NOT NULL,
  `severity` VARCHAR(20) NOT NULL, `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN', `summary` VARCHAR(500) NOT NULL,
  `metric_value` DOUBLE NULL, `threshold` DOUBLE NULL, `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `acknowledged_by` VARCHAR(191) NULL, `muted_until` DATETIME(3) NULL, `recovered_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `system_alerts_fingerprint_key` (`fingerprint`),
  INDEX `system_alerts_status_severity_detected_at_idx` (`status`, `severity`, `detected_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
