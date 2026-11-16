BEGIN;
ALTER TABLE questions ALTER COLUMN status SET DEFAULT 'PUBLISHED';
UPDATE questions SET status = 'PUBLISHED' WHERE status IN ('DRAFT', 'PENDING_REVIEW');
UPDATE system_settings SET value = value - 'questionApprovalMode' WHERE key = 'platform';
DROP TABLE IF EXISTS grade_history;
DELETE FROM audit_logs WHERE entity_type = 'identity';
COMMIT;
