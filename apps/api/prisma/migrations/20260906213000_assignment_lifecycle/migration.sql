ALTER TABLE `assignments`
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `closed_at` DATETIME(3) NULL,
  ADD COLUMN `closed_by_id` VARCHAR(191) NULL,
  ADD COLUMN `close_reason` TEXT NULL;

ALTER TABLE `assignment_submissions`
  ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `assignment_submission_attachments`
  ADD COLUMN `removed_at` DATETIME(3) NULL,
  ADD COLUMN `removed_by_id` VARCHAR(191) NULL,
  ADD COLUMN `removal_error` TEXT NULL;

CREATE TABLE `assignment_changes` (
  `id` VARCHAR(191) NOT NULL,
  `assignment_id` VARCHAR(191) NOT NULL,
  `actor_id` VARCHAR(191) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `reason` TEXT NULL,
  `from_version` INTEGER NOT NULL,
  `to_version` INTEGER NOT NULL,
  `snapshot` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `assignment_changes_assignment_id_created_at_idx` (`assignment_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `assignment_changes_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `assignments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assignment_submission_revisions` (
  `id` VARCHAR(191) NOT NULL,
  `submission_id` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL,
  `content` TEXT NOT NULL,
  `attachments` JSON NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `assignment_submission_revisions_submission_id_revision_key` (`submission_id`, `revision`),
  PRIMARY KEY (`id`),
  CONSTRAINT `assignment_submission_revisions_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `assignment_grade_changes` (
  `id` VARCHAR(191) NOT NULL,
  `submission_id` VARCHAR(191) NOT NULL,
  `submission_revision` INTEGER NOT NULL,
  `actor_id` VARCHAR(191) NOT NULL,
  `action` VARCHAR(30) NOT NULL,
  `previous_score` DECIMAL(8, 2) NULL,
  `next_score` DECIMAL(8, 2) NOT NULL,
  `previous_rubric` JSON NULL,
  `next_rubric` JSON NOT NULL,
  `previous_feedback` TEXT NULL,
  `next_feedback` TEXT NOT NULL,
  `reason` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `assignment_grade_changes_submission_id_created_at_idx` (`submission_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `assignment_grade_changes_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `assignment_submission_revisions` (`id`, `submission_id`, `revision`, `content`, `attachments`, `submitted_at`)
SELECT CONCAT('submission-revision-', UUID()), submission.`id`, 1, submission.`content`,
  COALESCE((
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'id', attachment.`id`,
      'objectKey', attachment.`object_key`,
      'originalName', attachment.`original_name`,
      'mimeType', attachment.`mime_type`,
      'sizeBytes', CAST(attachment.`size_bytes` AS CHAR),
      'checksum', attachment.`checksum`
    ))
    FROM `assignment_submission_attachments` attachment
    WHERE attachment.`submission_id` = submission.`id`
  ), JSON_ARRAY()),
  submission.`submitted_at`
FROM `assignment_submissions` submission;
