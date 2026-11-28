-- pg_trgm is installed by 20261124020000_material_search_trigram.
-- Build outside a transaction so course writes remain available.
CREATE INDEX CONCURRENTLY courses_search_trgm_idx
ON courses USING gin (code gin_trgm_ops, name gin_trgm_ops, description gin_trgm_ops);
