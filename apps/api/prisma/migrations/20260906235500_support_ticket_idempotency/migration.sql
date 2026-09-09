ALTER TABLE `support_tickets`
  ADD COLUMN `client_request_id` VARCHAR(36) NULL;

CREATE UNIQUE INDEX `support_tickets_reporter_id_client_request_id_key`
  ON `support_tickets`(`reporter_id`, `client_request_id`);
