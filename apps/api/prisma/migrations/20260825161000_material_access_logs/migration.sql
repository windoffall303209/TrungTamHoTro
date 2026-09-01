-- CreateTable
CREATE TABLE `material_access_logs` (
    `id` VARCHAR(191) NOT NULL,
    `material_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `material_access_logs_material_id_created_at_idx`(`material_id`, `created_at`),
    INDEX `material_access_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `material_access_logs` ADD CONSTRAINT `material_access_logs_material_id_fkey` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_access_logs` ADD CONSTRAINT `material_access_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
