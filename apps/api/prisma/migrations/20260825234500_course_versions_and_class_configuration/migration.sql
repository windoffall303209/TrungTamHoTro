CREATE TABLE `course_versions` (
  `id` VARCHAR(191) NOT NULL,
  `course_id` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `outcomes` JSON NOT NULL,
  `published_by` VARCHAR(191) NOT NULL,
  `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `course_versions_course_id_version_key` (`course_id`, `version`),
  INDEX `course_versions_course_id_published_at_idx` (`course_id`, `published_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `course_versions_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `course_versions` (`id`, `course_id`, `version`, `name`, `description`, `outcomes`, `published_by`, `published_at`)
SELECT CONCAT('course-version-', `id`, '-', `version`), `id`, `version`, `name`, `description`, `outcomes`, `owner_id`, `updated_at`
FROM `courses`
WHERE `status` = 'PUBLISHED';

ALTER TABLE `learning_classes`
  DROP INDEX `learning_classes_code_key`,
  ADD COLUMN `course_version` INTEGER NOT NULL DEFAULT 1 AFTER `course_id`,
  ADD COLUMN `timezone` VARCHAR(80) NOT NULL DEFAULT 'Asia/Bangkok' AFTER `capacity`,
  ADD COLUMN `allow_late_enrollment` BOOLEAN NOT NULL DEFAULT false AFTER `timezone`,
  ADD UNIQUE INDEX `learning_classes_code_term_key` (`code`, `term`);
