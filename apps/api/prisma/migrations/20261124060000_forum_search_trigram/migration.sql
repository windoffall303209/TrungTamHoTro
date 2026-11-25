-- Reuse the immutable text/tag decoder installed by the material search migration.
-- Concurrent creation must remain outside a transaction.
CREATE INDEX CONCURRENTLY forum_topics_search_text_trgm_idx
ON forum_topics USING gin (public.wind_material_search_text(title, body, tags) gin_trgm_ops);
