ALTER TABLE `exams`
  ADD COLUMN `generation_request_id` VARCHAR(100) NULL,
  ADD UNIQUE INDEX `exams_generation_request_id_key` (`generation_request_id`);
