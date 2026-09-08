ALTER TABLE `ai_study_drafts`
  ADD COLUMN `published_result` JSON NULL,
  ADD COLUMN `published_at` DATETIME(3) NULL,
  ADD COLUMN `publication_revision` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `published_edit_revision` INTEGER NULL;
