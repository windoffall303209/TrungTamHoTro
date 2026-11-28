-- Gỡ bỏ bảng lịch sử phiên bản bài nộp tự luận; giữ nguyên bài nộp mới nhất (cùng cột revision) và các tệp hiện hành.
DELETE FROM "assignment_submission_attachments"
WHERE "removed_at" IS NOT NULL
  AND "removal_error" IS NULL;

DROP TABLE IF EXISTS "assignment_submission_revisions";
