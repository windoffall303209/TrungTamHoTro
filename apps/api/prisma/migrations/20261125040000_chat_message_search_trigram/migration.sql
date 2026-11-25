-- pg_trgm đã được cài từ migration 20261124020000_material_search_trigram.
-- Tạo index CONCURRENTLY ngoài transaction để không khóa ghi bảng chat_messages khi triển khai.
CREATE INDEX CONCURRENTLY "chat_messages_content_trgm_idx"
ON "chat_messages" USING gin ("content" gin_trgm_ops);
