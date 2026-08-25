ALTER TABLE `questions`
  ADD COLUMN `family_id` VARCHAR(191) NULL,
  ADD COLUMN `supersedes_id` VARCHAR(191) NULL,
  ADD COLUMN `content_hash` VARCHAR(64) NULL;

UPDATE `questions`
SET `family_id` = `id`,
    `content_hash` = SHA2(LOWER(TRIM(REGEXP_REPLACE(`content`, '[[:space:]]+', ' '))), 256)
WHERE `family_id` IS NULL;

ALTER TABLE `questions`
  MODIFY `family_id` VARCHAR(191) NOT NULL,
  MODIFY `content_hash` VARCHAR(64) NOT NULL,
  ADD INDEX `questions_family_id_version_idx` (`family_id`, `version`),
  ADD INDEX `questions_course_id_content_hash_idx` (`course_id`, `content_hash`);
