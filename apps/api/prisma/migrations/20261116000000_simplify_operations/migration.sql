BEGIN;
ALTER TABLE backup_jobs RENAME TO operational_jobs;
ALTER TABLE operational_jobs RENAME CONSTRAINT backup_jobs_pkey TO operational_jobs_pkey;
ALTER TABLE operational_jobs ALTER COLUMN type DROP NOT NULL,
  ADD COLUMN kind varchar(10),
  ADD COLUMN backup_id text REFERENCES operational_jobs(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN mode varchar(30), ADD COLUMN approved_by varchar(191), ADD COLUMN reason varchar(500),
  ADD COLUMN target_database varchar(191), ADD COLUMN approved_at timestamp(3), ADD COLUMN verification text,
  ADD COLUMN category varchar(100), ADD COLUMN format varchar(20), ADD COLUMN row_count integer, ADD COLUMN expires_at timestamp(3);
UPDATE operational_jobs SET kind = 'BACKUP';
INSERT INTO operational_jobs (kind, id, backup_id, mode, requested_by, approved_by, reason, target_database, approved_at, status, verification, created_at, completed_at)
SELECT 'RESTORE', id, backup_id, mode, requested_by, approved_by, reason, target_database, approved_at, status, verification, created_at, completed_at FROM restore_jobs;
INSERT INTO operational_jobs (kind, id, category, format, status, row_count, object_key, checksum, size_bytes, error_message, requested_by, attempts, progress, available_at, expires_at, created_at)
SELECT 'EXPORT', id, category, format, status, row_count, object_key, checksum, size_bytes, error_message, requested_by, attempts, progress, available_at, expires_at, created_at FROM data_export_jobs;
DROP TABLE restore_jobs, data_export_jobs;
ALTER TABLE operational_jobs ALTER COLUMN kind SET NOT NULL,
  ADD CONSTRAINT operational_jobs_shape CHECK (
    (kind = 'BACKUP' AND type IS NOT NULL AND backup_id IS NULL) OR
    (kind = 'RESTORE' AND backup_id IS NOT NULL AND mode IS NOT NULL) OR
    (kind = 'EXPORT' AND category IS NOT NULL AND format IS NOT NULL AND backup_id IS NULL)
  );
DROP INDEX backup_jobs_status_created_at_idx;
DROP INDEX backup_jobs_status_available_at_idx;
CREATE INDEX operational_jobs_kind_status_available_at_idx ON operational_jobs(kind,status,available_at);
CREATE INDEX operational_jobs_kind_created_at_idx ON operational_jobs(kind,created_at);
CREATE INDEX operational_jobs_kind_status_expires_at_idx ON operational_jobs(kind,status,expires_at);
CREATE INDEX operational_jobs_backup_id_idx ON operational_jobs(backup_id);
DROP TABLE report_runs, report_exports, attendance_appeals, attendance_intervals, attendance_records, content_reports, moderation_actions, moderation_policies, chat_message_reports, exam_approvals, assignment_changes, notification_templates;
ALTER TABLE live_sessions DROP COLUMN attendance_locked_by_id, DROP COLUMN attendance_locked_at;
UPDATE exams SET status = 'DRAFT' WHERE status = 'PENDING_REVIEW';
COMMIT;
