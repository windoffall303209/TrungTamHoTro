-- pg_trgm is installed by 20261124020000_material_search_trigram.
-- Keep concurrent index creation outside a transaction.
CREATE INDEX CONCURRENTLY learning_classes_search_trgm_idx
ON learning_classes USING gin (code gin_trgm_ops, name gin_trgm_ops, term gin_trgm_ops);
