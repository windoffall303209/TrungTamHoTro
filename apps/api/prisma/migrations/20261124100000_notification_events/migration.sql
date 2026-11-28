-- In-transaction signals are delivered on commit, deduplicated per recipient by PostgreSQL.
CREATE FUNCTION wind_notification_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM pg_notify('wind_events',json_build_object('kind','notification','key',OLD.recipient_id)::text);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP='INSERT' OR OLD.recipient_id IS DISTINCT FROM NEW.recipient_id THEN
      PERFORM pg_notify('wind_events',json_build_object('kind','notification','key',NEW.recipient_id)::text);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER notification_event AFTER INSERT OR UPDATE OR DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION wind_notification_event();
