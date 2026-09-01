CREATE TABLE `material_versions` (
  `id` VARCHAR(191) NOT NULL,
  `material_id` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `object_key` VARCHAR(500) NOT NULL,
  `mime_type` VARCHAR(150) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `checksum` VARCHAR(128) NULL,
  `folder` VARCHAR(255) NOT NULL,
  `tags` JSON NOT NULL,
  `visibility` ENUM('DRAFT', 'PUBLISHED', 'HIDDEN') NOT NULL,
  `created_by` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `material_versions_material_id_version_key` (`material_id`, `version`),
  INDEX `material_versions_created_at_idx` (`created_at`),
  CONSTRAINT `material_versions_material_id_fkey` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `material_versions` (`id`, `material_id`, `version`, `name`, `object_key`, `mime_type`, `size_bytes`, `checksum`, `folder`, `tags`, `visibility`, `created_by`, `created_at`)
SELECT CONCAT('material-version-', `id`, '-', `version`), `id`, `version`, `name`, `object_key`, `mime_type`, `size_bytes`, `checksum`, `folder`, `tags`, `visibility`, `owner_id`, `created_at`
FROM `materials`;
