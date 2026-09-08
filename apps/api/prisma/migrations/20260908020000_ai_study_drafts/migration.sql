CREATE TABLE `ai_study_drafts` (
  `id` VARCHAR(191) NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `owner_id` VARCHAR(191) NOT NULL,
  `material_id` VARCHAR(191) NOT NULL,
  `source_version` INTEGER NOT NULL,
  `state` ENUM('GENERATING', 'READY', 'UNCERTAIN') NOT NULL DEFAULT 'GENERATING',
  `options` JSON NOT NULL,
  `result` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ai_study_drafts_fingerprint_key` (`fingerprint`),
  INDEX `ai_study_drafts_owner_id_material_id_created_at_id_idx` (`owner_id`, `material_id`, `created_at`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_study_drafts_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ai_study_drafts_material_id_source_version_fkey` FOREIGN KEY (`material_id`, `source_version`) REFERENCES `material_versions` (`material_id`, `version`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
