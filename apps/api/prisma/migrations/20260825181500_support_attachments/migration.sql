ALTER TABLE `support_tickets`
    ADD COLUMN `context_id` VARCHAR(191) NULL,
    ADD COLUMN `duplicate_of_id` VARCHAR(191) NULL,
    ADD INDEX `support_tickets_duplicate_of_id_idx`(`duplicate_of_id`);

CREATE TABLE `support_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `uploader_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `object_key` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(150) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `checksum` VARCHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `support_attachments_object_key_key`(`object_key`),
    INDEX `support_attachments_ticket_id_created_at_idx`(`ticket_id`, `created_at`),
    INDEX `support_attachments_uploader_id_idx`(`uploader_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `support_attachments`
    ADD CONSTRAINT `support_attachments_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `support_attachments_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `support_tickets`
    ADD CONSTRAINT `support_tickets_duplicate_of_id_fkey` FOREIGN KEY (`duplicate_of_id`) REFERENCES `support_tickets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
