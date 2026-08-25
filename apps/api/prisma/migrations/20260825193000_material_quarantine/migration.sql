ALTER TABLE `materials`
    ADD COLUMN `quarantined_at` DATETIME(3) NULL,
    ADD COLUMN `quarantine_reason` VARCHAR(500) NULL;

CREATE INDEX `materials_quarantined_at_idx` ON `materials`(`quarantined_at`);
