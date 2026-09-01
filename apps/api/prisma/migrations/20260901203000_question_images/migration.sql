ALTER TABLE `questions`
  ADD COLUMN `image_object_key` VARCHAR(500) NULL,
  ADD COLUMN `image_name` VARCHAR(255) NULL,
  ADD COLUMN `image_mime_type` VARCHAR(100) NULL,
  ADD COLUMN `image_size_bytes` BIGINT NULL,
  ADD COLUMN `image_checksum` VARCHAR(128) NULL;
