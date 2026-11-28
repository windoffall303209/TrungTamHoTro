-- Không bọc trong transaction vì index được tạo concurrently.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Dùng giá trị tag đã giải mã JSON, tránh bỏ sót dấu nháy/backslash khi tìm kiếm.
-- Điều kiện tìm kiếm gốc vẫn đối chiếu từng trường để loại kết quả vượt ranh giới trường/tag.
CREATE FUNCTION public.wind_material_search_text(text, text, jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT $1 || E'\n' || $2 || E'\n' || COALESCE(
    (SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof($3) = 'array' THEN $3 ELSE '[]'::jsonb END
    ) AS tags(value)), '')
$$;

CREATE INDEX CONCURRENTLY "materials_search_text_trgm_idx"
ON "materials" USING gin (public.wind_material_search_text("name", "folder", "tags") gin_trgm_ops);
