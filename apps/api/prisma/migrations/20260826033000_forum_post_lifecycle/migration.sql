ALTER TABLE `forum_posts`
  ADD COLUMN `edit_history` JSON NULL,
  ADD COLUMN `edited_at` DATETIME(3) NULL,
  ADD COLUMN `deleted_at` DATETIME(3) NULL;
