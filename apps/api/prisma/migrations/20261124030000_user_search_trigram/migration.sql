-- pg_trgm is installed by 20261124020000_material_search_trigram.
-- Keep this concurrent build outside a transaction to allow account writes.
CREATE INDEX CONCURRENTLY users_search_trgm_idx
ON users USING gin (username gin_trgm_ops, display_name gin_trgm_ops, email gin_trgm_ops);
