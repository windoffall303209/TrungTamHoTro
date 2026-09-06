ALTER TABLE `chat_messages`
  ADD COLUMN `context_type` VARCHAR(30) NULL,
  ADD COLUMN `context_id` VARCHAR(191) NULL;

CREATE TABLE `chat_message_attachments` (
  `id` VARCHAR(191) NOT NULL,
  `message_id` VARCHAR(191) NOT NULL,
  `object_key` VARCHAR(500) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(150) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `checksum` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `chat_message_attachments_object_key_key`(`object_key`),
  INDEX `chat_message_attachments_message_id_created_at_idx`(`message_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `chat_message_attachments_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_message_mentions` (
  `message_id` VARCHAR(191) NOT NULL,
  `mentioned_user_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `chat_message_mentions_mentioned_user_id_created_at_idx`(`mentioned_user_id`, `created_at`),
  PRIMARY KEY (`message_id`, `mentioned_user_id`),
  CONSTRAINT `chat_message_mentions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_message_reports` (
  `id` VARCHAR(191) NOT NULL,
  `message_id` VARCHAR(191) NOT NULL,
  `reporter_id` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `chat_message_reports_message_id_reporter_id_key`(`message_id`, `reporter_id`),
  INDEX `chat_message_reports_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `chat_message_reports_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_blocks` (
  `blocker_id` VARCHAR(191) NOT NULL,
  `blocked_id` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `user_blocks_blocked_id_created_at_idx`(`blocked_id`, `created_at`),
  PRIMARY KEY (`blocker_id`, `blocked_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
