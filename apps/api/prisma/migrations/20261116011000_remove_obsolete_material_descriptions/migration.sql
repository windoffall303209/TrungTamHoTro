BEGIN;
UPDATE materials m
SET tags = (SELECT COALESCE(jsonb_agg(tag ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(m.tags) WITH ORDINALITY AS entry(tag, position)
  WHERE NOT (jsonb_typeof(tag) = 'string' AND tag #>> '{}' LIKE 'Mô tả: %'))
WHERE jsonb_typeof(tags) = 'array' AND tags::text LIKE '%"Mô tả: %';
UPDATE material_versions m
SET tags = (SELECT COALESCE(jsonb_agg(tag ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(m.tags) WITH ORDINALITY AS entry(tag, position)
  WHERE NOT (jsonb_typeof(tag) = 'string' AND tag #>> '{}' LIKE 'Mô tả: %'))
WHERE jsonb_typeof(tags) = 'array' AND tags::text LIKE '%"Mô tả: %';
COMMIT;
