-- audit_logs chỉ ghi thêm: chặn UPDATE/DELETE/TRUNCATE trừ khi một job lưu trữ có kiểm soát bật cờ phiên
-- wind_edu.audit_maintenance = 'on' (SET LOCAL trong transaction). Ngoại lệ duy nhất là FK ON DELETE SET NULL
-- gỡ actor_id khi xóa người dùng mà không đổi bất kỳ trường nội dung nào của nhật ký.
CREATE OR REPLACE FUNCTION "audit_logs_prevent_mutation"() RETURNS trigger AS $$
BEGIN
  IF current_setting('wind_edu.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND NEW.id = OLD.id
    AND NEW.action = OLD.action
    AND NEW.entity_type = OLD.entity_type
    AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
    AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
    AND NEW.context IS NOT DISTINCT FROM OLD.context
    AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs chỉ cho phép ghi thêm; không được sửa hoặc xóa nhật ký kiểm toán.' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "audit_logs_prevent_truncate"() RETURNS trigger AS $$
BEGIN
  IF current_setting('wind_edu.audit_maintenance', true) = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'audit_logs chỉ cho phép ghi thêm; không được TRUNCATE nhật ký kiểm toán.' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_prevent_mutation"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_prevent_truncate"();
