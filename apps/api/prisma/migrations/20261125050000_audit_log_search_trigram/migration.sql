-- pg_trgm đã được cài từ migration 20261124020000_material_search_trigram.
-- Hàm biểu thức bất biến gom 4 trường tìm kiếm audit (actor/action/target/context) cho prefilter GIN;
-- truy vấn thực thi vẫn giữ điều kiện OR từng trường để tránh khớp chéo ranh giới trường.
CREATE FUNCTION public.wind_audit_search_text(text, text, text, text, jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE($1, 'system') || E'\n' || COALESCE($2, '') || E'\n' || COALESCE($3, $4, '') || E'\n' || COALESCE($5::text, '')
$$;

-- Tạo index CONCURRENTLY ngoài transaction để không khóa ghi nhật ký audit khi triển khai.
CREATE INDEX CONCURRENTLY "audit_logs_search_text_trgm_idx"
ON "audit_logs" USING gin (public.wind_audit_search_text("actor_id", "action", "entity_id", "entity_type", "context") gin_trgm_ops);
