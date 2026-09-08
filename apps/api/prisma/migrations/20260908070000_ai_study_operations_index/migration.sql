-- Support metadata-only administrator queries without scanning private JSON results.
CREATE INDEX `ai_study_operations_state_created_id`
ON `ai_study_drafts` (`state`, `created_at`, `id`);
