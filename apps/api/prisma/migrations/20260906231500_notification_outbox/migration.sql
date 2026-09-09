CREATE TABLE `outbox_events` (
  `id` VARCHAR(191) NOT NULL,
  `type` VARCHAR(100) NOT NULL,
  `aggregate_type` VARCHAR(100) NOT NULL,
  `aggregate_id` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `outbox_events_type_created_at_idx` (`type`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `outbox_deliveries` (
  `id` VARCHAR(191) NOT NULL,
  `event_id` VARCHAR(191) NOT NULL,
  `recipient_id` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(30) NOT NULL,
  `dedup_key` VARCHAR(255) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `provider_message_id` VARCHAR(191) NULL,
  `last_error` VARCHAR(500) NULL,
  `delivered_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `outbox_deliveries_dedup_key_key` (`dedup_key`),
  INDEX `outbox_deliveries_status_available_at_idx` (`status`, `available_at`),
  INDEX `outbox_deliveries_recipient_id_created_at_idx` (`recipient_id`, `updated_at` DESC),
  CONSTRAINT `outbox_deliveries_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `outbox_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TRIGGER `notifications_after_insert_outbox_event`
AFTER INSERT ON `notifications`
FOR EACH ROW
  INSERT IGNORE INTO `outbox_events` (`id`, `type`, `aggregate_type`, `aggregate_id`, `payload`, `created_at`)
  VALUES (CONCAT('notification:', NEW.`id`), 'NOTIFICATION_CREATED', NEW.`entity_type`, NEW.`entity_id`, JSON_OBJECT('notificationId', NEW.`id`, 'recipientId', NEW.`recipient_id`, 'notificationType', NEW.`type`, 'title', NEW.`title`, 'entityType', NEW.`entity_type`, 'entityId', NEW.`entity_id`), NEW.`created_at`);

CREATE TRIGGER `notifications_after_insert_outbox_delivery`
AFTER INSERT ON `notifications`
FOR EACH ROW
FOLLOWS `notifications_after_insert_outbox_event`
  INSERT IGNORE INTO `outbox_deliveries` (`id`, `event_id`, `recipient_id`, `channel`, `dedup_key`, `status`, `attempts`, `available_at`, `updated_at`)
  VALUES (CONCAT('delivery:email:', NEW.`id`), CONCAT('notification:', NEW.`id`), NEW.`recipient_id`, 'EMAIL', CONCAT('notification:', NEW.`id`, ':', NEW.`recipient_id`, ':EMAIL'), 'PENDING', 0, NEW.`created_at`, NEW.`created_at`);
