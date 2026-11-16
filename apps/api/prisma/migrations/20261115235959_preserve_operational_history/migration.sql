-- Preserve retired operational data before the following released migration drops its public tables.
DO $archive$
DECLARE
  source_table text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY['report_runs','report_exports','attendance_appeals',
    'attendance_intervals','attendance_records','content_reports','moderation_actions',
    'moderation_policies','chat_message_reports','exam_approvals','assignment_changes','notification_templates']
  LOOP
    IF to_regclass(format('public.%I', source_table)) IS NOT NULL THEN
      CREATE SCHEMA IF NOT EXISTS operational_history;
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', source_table);
      EXECUTE format('CREATE TABLE operational_history.%I (LIKE public.%I INCLUDING ALL)', source_table, source_table);
      EXECUTE format('INSERT INTO operational_history.%I SELECT * FROM public.%I', source_table, source_table);
    END IF;
  END LOOP;
END
$archive$;
