CREATE TABLE `forum_post_attachments` (
    `post_id` VARCHAR(191) NOT NULL,
    `material_id` VARCHAR(191) NOT NULL,
    INDEX `forum_post_attachments_material_id_idx`(`material_id`),
    PRIMARY KEY (`post_id`, `material_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `forum_mentions` (
    `post_id` VARCHAR(191) NOT NULL,
    `mentioned_user_id` VARCHAR(191) NOT NULL,
    INDEX `forum_mentions_mentioned_user_id_idx`(`mentioned_user_id`),
    PRIMARY KEY (`post_id`, `mentioned_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `recipient_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `dedup_key` VARCHAR(255) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `notifications_dedup_key_key`(`dedup_key`),
    INDEX `notifications_recipient_id_read_at_created_at_idx`(`recipient_id`, `read_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `forum_post_attachments`
    ADD CONSTRAINT `forum_post_attachments_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `forum_post_attachments_material_id_fkey` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `forum_mentions`
    ADD CONSTRAINT `forum_mentions_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `forum_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `forum_mentions_mentioned_user_id_fkey` FOREIGN KEY (`mentioned_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notifications`
    ADD CONSTRAINT `notifications_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
