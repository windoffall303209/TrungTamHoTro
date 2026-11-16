BEGIN;

-- Xóa các bản sao do migration preserve_operational_history tạo.
DROP TABLE IF EXISTS
  operational_history.report_runs,
  operational_history.report_exports,
  operational_history.attendance_appeals,
  operational_history.attendance_intervals,
  operational_history.attendance_records,
  operational_history.content_reports,
  operational_history.moderation_actions,
  operational_history.moderation_policies,
  operational_history.chat_message_reports,
  operational_history.exam_approvals,
  operational_history.assignment_changes,
  operational_history.notification_templates;
DROP SCHEMA IF EXISTS operational_history RESTRICT;

-- DB test từng bỏ qua bước drop_unused_attendance_report_types cũng cần dọn enum.
DROP TYPE IF EXISTS public."AttendanceStatus", public."ReportStatus",
  public."ReportExportStatus", public."AttendanceAppealStatus";

COMMIT;
