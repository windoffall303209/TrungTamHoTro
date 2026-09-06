ALTER TABLE `materials` ADD COLUMN `course_id` VARCHAR(191) NULL;

UPDATE `materials` AS `m`
INNER JOIN `learning_classes` AS `c` ON `c`.`id` = `m`.`class_id`
SET `m`.`course_id` = `c`.`course_id`;

ALTER TABLE `materials`
  MODIFY COLUMN `course_id` VARCHAR(191) NOT NULL,
  ADD INDEX `materials_course_id_visibility_idx` (`course_id`, `visibility`),
  ADD CONSTRAINT `materials_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
