CREATE TABLE `assignment_submission_attachments` (
  `id` VARCHAR(191) NOT NULL,
  `submission_id` VARCHAR(191) NOT NULL,
  `object_key` VARCHAR(500) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(150) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `checksum` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `assignment_submission_attachments_object_key_key`(`object_key`),
  INDEX `assignment_submission_attachments_submission_id_created_at_idx`(`submission_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `assignment_submission_attachments`
  ADD CONSTRAINT `assignment_submission_attachments_submission_id_fkey`
  FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
