ALTER TABLE `users`
  ADD COLUMN `avatar_object_key` VARCHAR(500) NULL,
  ADD COLUMN `avatar_mime_type` VARCHAR(50) NULL,
  ADD COLUMN `avatar_updated_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `users_avatar_object_key_key` ON `users`(`avatar_object_key`);
