-- No job payload/identifier leaves PostgreSQL: authorized clients receive only a refresh hint.
CREATE FUNCTION wind_operational_job_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
  PERFORM pg_notify('wind_events','{"kind":"job","key":"operations"}');
  RETURN NULL;
END $$;
CREATE TRIGGER operational_job_event AFTER INSERT OR UPDATE OR DELETE ON operational_jobs
FOR EACH ROW EXECUTE FUNCTION wind_operational_job_event();
