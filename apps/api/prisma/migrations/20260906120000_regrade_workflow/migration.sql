ALTER TABLE `regrade_requests`
  ADD COLUMN `assigned_to_id` VARCHAR(191) NULL,
  ADD COLUMN `resolved_by_id` VARCHAR(191) NULL,
  ADD COLUMN `resolved_at` DATETIME(3) NULL;

CREATE INDEX `regrade_requests_assigned_to_id_status_idx`
  ON `regrade_requests`(`assigned_to_id`, `status`);

ALTER TABLE `legal_holds`
  ADD COLUMN `released_by` VARCHAR(191) NULL,
  ADD COLUMN `release_reason` VARCHAR(500) NULL;

CREATE TABLE `chat_conversations` (
  `id` VARCHAR(191) NOT NULL,
  `type` ENUM('DIRECT', 'CLASS') NOT NULL,
  `class_id` VARCHAR(191) NULL,
  `direct_key` VARCHAR(383) NULL,
  `created_by_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `chat_conversations_class_id_key` (`class_id`),
  UNIQUE INDEX `chat_conversations_direct_key_key` (`direct_key`),
  INDEX `chat_conversations_type_updated_at_idx` (`type`, `updated_at`),
  CONSTRAINT `chat_conversations_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `learning_classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_conversation_members` (
  `conversation_id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `role_snapshot` VARCHAR(50) NOT NULL,
  `status` ENUM('ACTIVE', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `removed_at` DATETIME(3) NULL,
  `last_read_at` DATETIME(3) NULL,
  `muted_until` DATETIME(3) NULL,
  PRIMARY KEY (`conversation_id`, `user_id`),
  INDEX `chat_conversation_members_user_id_status_idx` (`user_id`, `status`),
  CONSTRAINT `chat_conversation_members_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chat_conversation_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_messages` (
  `id` VARCHAR(191) NOT NULL,
  `conversation_id` VARCHAR(191) NOT NULL,
  `sender_id` VARCHAR(191) NOT NULL,
  `client_message_id` VARCHAR(100) NOT NULL,
  `content` TEXT NOT NULL,
  `reply_to_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `chat_messages_sender_id_client_message_id_key` (`sender_id`, `client_message_id`),
  INDEX `chat_messages_conversation_id_created_at_idx` (`conversation_id`, `created_at`),
  CONSTRAINT `chat_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chat_messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chat_messages_reply_to_id_fkey` FOREIGN KEY (`reply_to_id`) REFERENCES `chat_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
