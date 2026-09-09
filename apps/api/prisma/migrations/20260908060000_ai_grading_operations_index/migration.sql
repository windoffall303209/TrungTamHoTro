-- Support administrator status filters and deterministic createdAt/id pagination.
CREATE INDEX `ai_grading_operations_state_created_id`
ON `ai_grading_suggestions` (`state`, `created_at`, `id`);
