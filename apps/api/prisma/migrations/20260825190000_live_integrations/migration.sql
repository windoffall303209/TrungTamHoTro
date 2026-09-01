ALTER TABLE `integration_providers`
    ADD COLUMN `webhook_url` VARCHAR(1000) NULL,
    ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `integration_providers_is_default_enabled_idx`
    ON `integration_providers`(`is_default`, `enabled`);
